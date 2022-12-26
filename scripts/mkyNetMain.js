const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
const {MkyNetObj}     = require('./mkyNetwork');
const {MkyWebConsole} = require('./networkWebConsole.js');
/*******************
Create BitMonky Network Peer
*******************
*/

  var isRoot   = process.argv[3];
  const mkyNet = new MkyNetObj(options);
  const myIp   = mkyNet.netIp();
  const wcon   = new MkyWebConsole(mkyNet);

main();
async function main(){
  await mkyNet.netStarted();
  sayHello(myIp);
}
  function sayHello(from){
    mkyNet.broadcast({msg : 'Hello!!! from: '+myIp});
    var t = setTimeout( ()=>{
      sayHello(from);
    },2*1351);
  }

