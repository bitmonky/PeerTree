/*
PeerTree Key Pair Server
Dust Removed: Date: Dec 28, 2022
*/

const sql  = require('mssql');
const config = require('./config.js');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

const options = {
  key: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/fullchain.pem')
};

var server = https.createServer(options, (req, res) => {

  res.writeHead(200);
  if (req.url == '/keyGEN'){
    // Generate a new key pair and convert them to hex-strings
    const key = ec.genKeyPair();
    const publicKey = key.getPublic('hex');
    const privateKey = key.getPrivate('hex');
    console.log('pub key length' + publicKey.length,publicKey);
    console.log('priv key length' + privateKey.length,publicKey);
    res.end('{"publicKey":"' + publicKey + '","privateKey":"' + privateKey + '"}');
  }
  else {
    if (req.url.indexOf('/netREQ/msg=') == 0){
      var msg = req.url.replace('/netREQ/msg=','');

      msg = msg.replace(/\+/g,' ');    
      msg = decodeURI(msg);
      msg = msg.replace(/%3A/g,':');
      msg = msg.replace(/%2C/g,',');

      var j = null;
      try {j = JSON.parse(msg);}
      catch {j = JSON.parse('{"result":"json parse error:"}');}
      console.log('mkyReq',JSON.stringify(j.tran));
 
      sql.connect(config, function (err) {
        if (err){
         console.log(err);
        }
        else {
          var request = new sql.Request();
          var hexSig = null;
          var tranID = null;
          var SQL = "select * from mkyBank.dbo.tblGoldTrans where gtrnSyncKey = '" + j.tran.syncKey + "'";
          console.log('fetching ',SQL);
          request.query(SQL , function (err, recordset) {
            if (err){
              console.log(err);
            }
            else {
              recordset.recordset.forEach(function (rec, index) {
                console.log(rec);
                tranID = rec.gtrnID;
                var chk = crypto.createHash('sha256').update(rec.gtrnID).digest('hex');
                if (chk == j.chk){
                  const sigHash = crypto.createHash('sha256').update(JSON.stringify(j.tran)).digest('hex'); 
                  const pkey = "9ca939c1af8bf1c3707c2a4ed24151a2d1de9d7458b3ebd9a5a1b2c64126d152";
                  const signingKey = ec.keyFromPrivate(pkey);
                  const sig = signingKey.sign(sigHash, 'base64');
                  hexSig = sig.toDER('hex');
                  
                  console.log('Tran Signature is: ',hexSig);
                  SQL = "update  mkyBank.dbo.tblGoldTrans set gtrnSignature = '" + hexSig + "' where gtrnID=" + tranID;
                  request.query(SQL , function (err, recordset) {
                    if (err){
                      console.log(SQL,err);
                    }
                    else {console.log('Transaction Signed And Saved');}
                  });
                } 
              });
            }
          });
        }
      });

      res.end('OK');  
    }  
    else {
      res.end('Wellcome To The PeerTree KeyGEN Server\nUse end point /keyGEN to request key pair');
    }
  }
});

server.listen(1338);
console.log('Server mkyKeyGEN7.2 running at admin.bitmonky.com:1338');



