function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

class BankBranchNode {
  constructor (branch,ip){
    this.ip = ip;
    this.id = branch;
  }
}
class BranchList {
  constructor (network){
    this.branch = [];
    this.net    = network;
    this.activeBranch = 1;
  }
  pickOneBy(branch){
    var blist = [];
    for (var brec of this.branch){
      if (brec.id == branch)
        blist.push(brec);
    }
    if(blist.length == 0)
      return null;
    else
      return blist[getRandomInt(blist.length)];
  }
  pickOne(){
    if(this.branch.length == 0) 
      return new BankBranchNode(2,'66.175.223.118');
    else 
      return this.branch[getRandomInt(this.branch.length)];
  }
  tryJoin(){
    return new Promise( (resolve,reject)=>{
      const gtime = setTimeout( ()=>{
        if(this.branch.length == 0)
          resolve(new BankBranchNode(2,'66.175.223.118'));
        else
          resolve(this.branch[getRandomInt(this.branch.length)]);
      },3000);
    });
  }
  addList(id,ip){
    const node = new BankBranchNode(id,ip);
    if (!this.inList(ip)){
      this.branch.push(node);
    }
    this.getActiveBranch();
  }
  getActiveBranch(){
    for (var brec of this.branch){
      if (brec.id > this.activeBranch)
        this.activeBranch = brec.id;
    }
  }
  inList(ip){
    for (var brec of this.branch){
      if (brec.ip == ip)
        return true;
    }
    return false;
  }
  showStatus(){
    //console.log('\nBranch Status Report:');
    //console.log('Branches In List: ',this.branch.length);
    for (var brec of this.branch){
      //console.log('->branch: ', brec);
    }
  }
  getBranchList(){
    var blist = this;
    var breq = {
      to : 'bankers',
      send : 'blistInfo'
    }
    this.net.broadcast(breq);
    var t = setTimeout(function (){
      blist.getBranchList();
    },50*1351);
  }
  handleReq(res,j){
    if (j.req == 'bcReply'){
      if (j.blistInfo){
        this.addList(j.blistInfo.id,j.blistInfo.ip);
        this.net.endRes(res,'{"result":"Banker Node Added"}');
        return true;
      }
    }
  return false;
  }
}
module.exports.BranchList = BranchList;
