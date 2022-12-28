/*
Dust Removed: Date: Dec 28, 2022
*/

const fs = require('fs');
const mkyPubKey = '04a5dc8478989c0122c3eb6750c08039a91abf175c458ff5d64dbf448df8f1ba6ac4a6839e5cb0c9c711b15e85dae98f04697e4126186c4eab425064a97910dedc';
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const crypto = require('crypto');
const dateFormat = require('./mkyDatef');
//const bs58 = require('bs58')
const bitcoin = require('bitcoinjs-lib');

class MkyMakeTransaction{
   constructor(amt,type,fromWId,branchId,to,privKey,rate){
     this.privKey = privKey;
     this.to      = to;
     this.from    = fromWId;
     this.branch  = branchId;
     this.rec = {
       gtlAmount    : amt,
       gtlBlockID   : null,
       gtlCityID    : 0,
       gtlDate      : dateFormat(Date.now(),"yyyy-mm-dd HH:MM:ss.l"),
       gtlGoldRate  : rate, //"0.00025967000000000",
       gtlGoldType  : "eGold",
       gtlMUID      : to,
       gtlQApp      : "mkyWallets.js",
       gtlSource    : "sendCoin",
       gtlSrcID     : fromWId,
       gtlTaxHold   : null,
       gtlTycTax    : 0,
       syncKey   : null
     }
   }
   signTransaction(){
     this.rec.syncKey  = crypto.createHash('sha256').update(JSON.stringify(this.rec)).digest('hex');
     const sigHash = crypto.createHash('sha256').update(JSON.stringify(this.rec)).digest('hex');
    //console.log(sigHash,this.privKey);
     const signingKey = ec.keyFromPrivate(this.privKey);
     const sig = signingKey.sign(sigHash, 'base64');
     const hexSig = sig.toDER('hex');

     const result = {
        trans : this.rec,
        sig   : hexSig,
        to    : this.to,
        from  : this.from,
        branch: this.branch
     }
     return result;
   }
}
class MkyPayment{
   constructor(amt,gtype,MUID,pKey,rate,blockId,btype){
     this.pKey  = pKey;
     this.rec = {
       gtlDate      : dateFormat(Date.now(),"yyyy-mm-dd HH:MM:ss.l"),
       gtlGoldType  : "eGold",
       gtlSource    : gtype,
       gtlSrcID     : blockId,
       gtlTycTax    : "0.000000000",
       gtlAmount    : amt,
       gtlCityID    : "0",
       gtlTaxHold   : null,
       gtlGoldRate  : rate, //"0.00025967000000000",
       syncKey      : null,
       gtlQApp      : btype,
       gtlMUID      : MUID
     }
   }
   signPayment(){
     this.rec.syncKey  = crypto.createHash('sha256').update(JSON.stringify(this.rec)).digest('hex'); 
     const sigHash = crypto.createHash('sha256').update(JSON.stringify(this.rec)).digest('hex');
     console.log(sigHash,this.pKey);
     const signingKey = ec.keyFromPrivate(this.pKey);
     const sig = signingKey.sign(sigHash, 'base64');
     const hexSig = sig.toDER('hex');

     const result = {
        trans : this.rec,
        sig   : hexSig
     }
     return result;
   }
}
class MkyWallet{
   constructor(branchID,branchIp,type,dbcon=null){
      this.status      = 'new';
      this.branchID    = branchID;
      this.branchWalID = null;
      this.publicKey   = null;
      this.privateKey  = null;
      this.branchIp    = branchIp;
      this.signingKey  = null;
      this.type        = type;
      this.dbcon       = dbcon;
      this.openWallet();
   }
   makePaymentRec(amt,gtype,rate,blockId,btype){
     blockId = ''+blockId;
     const payment = new MkyPayment(amt,gtype,this.branchMUID,this.privateKey,rate,blockId,btype);
     return payment.signPayment();
   }
   makeSendCoinRec(to,amt,rate){
     const sendRec = new MkyMakeTransaction(amt,this.branchWalID,this.branchId,to,this.privateKey,rate);
   }      
   openWallet(){
      var keypair = null;
      try {keypair =  fs.readFileSync('keys/myMkyWallet.key');}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      this.publicKey = null;
      if (keypair){
        try {
          const pair = keypair.toString();
          const j = JSON.parse(pair);
          console.log(j);
          this.publicKey    = j.publicKey;
          this.privateKey   = j.privateKey;
          this.branchID     = j.branchID;
          this.branchWalID  = j.branchWalID;
          this.branchMUID   = j.branchMUID;
          this.signingKey   = ec.keyFromPrivate(this.privateKey);
          if (j.branchID)
            this.status     = 'Onfile';
        }
        catch {console.log('wallet file not valid');process.exit();}
      }
      else {
        if (!this.branchID){ 
          console.log('this brankID is null in openWallet()');
          return;
        } 
        const key = ec.genKeyPair();
        this.publicKey = key.getPublic('hex');
        this.privateKey = key.getPrivate('hex');

        console.log('Generate a new wallet key pair and convert them to hex-strings');
        //this.branchMUID = crypto.createHash('sha256').update(JSON.stringify(this.branchID + this.branchIp + Date.now())).digest('hex');
        //const bytes = Buffer.from(this.branchMUID, 'hex');
        //this.branchMUID = bs58.encode(bytes);
        const mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer(''+this.publicKey, 'hex') });
        this.branchMUID = mkybc.address;

        const muid = '"branchMUID":"' + this.branchMUID + '",';

        const brInfo = '"branchID":"' + this.branchID + '","branchWalID":"' + this.branchWalID + '","branchIp":"' + this.branchIp + '"';
        const wallet = '{' + muid + brInfo + ',"publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '"}';

        fs.writeFile('keys/myMkyWallet.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
        this.signingKey = ec.keyFromPrivate(this.privateKey);

        let wal = this;
        if (this.dbcon){
          const db = this.dbcon;
          let SQL = "select count(*)nRec from tblmkyWallets where mwalMUID = '"+wal.branchMUID+"'";
          db.query(SQL, function (err, result, fields) {
            if (err) throw err;
            else {
              let SQL = "insert into tblmkyWallets (mwalPubKey,mwalGBranchID,mwalDate,mwalMUID) ";
              SQL += "values('" + wal.publicKey + "'," + wal.branchID + ",now(),'" + wal.branchMUID + "')";

              db.query(SQL, function (err, result, fields) {
                if (err) throw err;
                 //console.log(SQL,result);
              });
            }
          });
        }
      }
   }
}
module.exports.MkyWallet = MkyWallet;
