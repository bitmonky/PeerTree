/*
Provides Asymmetric encryption for sending encrypted email messages
to be stored on the peerTree network.
*/

var crypto = require("crypto");
var path = require("path");
var fs = require("fs");

const { writeFileSync } = require('fs')
const { generateKeyPairSync } = require('crypto')

const passphrase = "mySecret"

class mkyECMail {
  constructor(passPhrase){
    this.passPhrase = passPhrase;
  } 
  encryptStringWithRsaPublicKey(toEncrypt, relativeOrAbsolutePathToPublicKey) {
    var absolutePath = path.resolve(relativeOrAbsolutePathToPublicKey);
    var publicKey = fs.readFileSync(absolutePath, "utf8");
    var buffer = Buffer.from(toEncrypt);
    var encrypted = crypto.publicEncrypt(publicKey, buffer);
    return encrypted.toString("base64");
  };

  decryptStringWithRsaPrivateKey(toDecrypt, relativeOrAbsolutePathtoPrivateKey) {
    var absolutePath = path.resolve(relativeOrAbsolutePathtoPrivateKey);
    var privateKey = fs.readFileSync(absolutePath, "utf8");
    var buffer = Buffer.from(toDecrypt, "base64");
    const decrypted = crypto.privateDecrypt(
        {
            key: privateKey.toString(),
            passphrase: this.passPhrase,
        },
        buffer,
    )
    return decrypted.toString("utf8");
  };


  generateKeys() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', 
    {
            modulusLength: 4096,
            namedCurve: 'secp256k1', 
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'     
            },     
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem',
                cipher: 'aes-256-cbc',
                passphrase: this.passPhrase
            } 
    });
    
    writeFileSync('pMailPrivate.pem', privateKey)
    writeFileSync('pMailPublic.pem', publicKey)
  }
};

var ecMail = new mkyECMail('testphrase');
ecMail.generateKeys();

let a = ecMail.encryptStringWithRsaPublicKey("hello", "pMailPublic.pem")
let b = ecMail.decryptStringWithRsaPrivateKey(a, "pMailPrivate.pem");
console.log(a)
console.log(b)
module.exports.mkyECMail = mkyECMail;