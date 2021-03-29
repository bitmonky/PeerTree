const mysql = require('mysql');

var con = mysql.createConnection({
  host: "localhost",
  user: "username",
  password: "password",
  database: "mkyBank",
  dateStrings: "date"
});
con.connect(function(err) {
  if (err) throw err;
});
var iDay = 2;
function main(){
  console.log("Start Main");
  let SQL = "select count(*)nRec from tblGoldTranLog where DATE(gtlDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
  con.query(SQL, function (err, result, fields) {
    if (err){console.log(err);}
    else {
      if (result[0].nRec == 0) {
        SQL = "SELECT count(*)nRec FROM tblGoldTrans where DATE(gtrnDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
        con.query(SQL, async function (err, result, fields) {
          if (err){console.log(err)}
          else {
            if(result[0].nRec > 0){
              //await setTransBlockNumbers(0);
              SQL = "insert into tblGoldTranLog (gtlDate,gtlGoldType,gtlSource,gtlSrcID,gtlTycTax,gtlAmount,gtlCityID ";
              SQL += ",gtlTaxHold,gtlGoldRate,syncKey,gtlQApp,gtlMUID,gtlBlockID,gtlSignature) ";
              SQL += "SELECT gtrnDate,gtrnGoldType,gtrnSource,gtrnSrcID,gtrnTycTax,gtrnAmount,gtrnCityID ";
              SQL += ",gtrnTaxHold,gtrnGoldRate,gtrnSyncKey,gtrnQApp,gtrnMUID,gtrnBlockID,gtrnSignature ";
              SQL += "FROM tblGoldTrans where DATE(gtrnDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
              console.log(SQL);
              con.query(SQL, function (err, result, fields) {
                if (err){console.log(err);}
                else {
                  SQL = "delete FROM tblGoldTrans where DATE(gtrnDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
                  con.query(SQL, function (err, result, fields) {
                    if (err) console.log(err);
                    else {
                      doDaySum();
                      console.log('Done '+SQL);
                    }
                  });
                }
              });
            }
            else {
              SQL = "select count(*)nRec FROM tblGoldTrans where DATE(gtrnDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
              con.query(SQL, function (err, result, fields) {
                if (err) console.log(err);
                else {
                  if (result[0].nRec > 0) {
                    SQL = "delete FROM tblGoldTrans where DATE(gtrnDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
                    con.query(SQL, function (err, result, fields) {
                      if (err) console.log(err);
                      else  console.log('Remove Undeleted Records  '+SQL);

                    });
                  }
                  doDaySum();
                }
              });
            }
          }
        });
      }
    }
  });
}
go();
//goBlock();

async function go(){
  while (1==1){
    main();
    await sleep(15*60*1000);
  }
}
async function goBlock(){
  while (1==1){
    setTransBlockNumbers(10);
    await sleep(15*1000);
  }
}

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}
function doBankSync(){}
function doDaySum(){
  console.log('update day sum log');
  SQL = "select count(*)nRec FROM tblGoldTranDaySum where  DATE(gtdsDate) = DATE(NOW() - INTERVAL "+iDay+" DAY)";
  con.query(SQL, function (err, result, fields) {
    if (err) console.log(err);
    else {
      const rec = result[0];
      if (rec.nRec == 0) {
        SQL  = "insert into tblGoldTranDaySum (gtdsDate,gtdsGoldType,gtdsSource,gtdsTycTax, ";
        SQL += "gtdsAmount,gtdsGoldRate,gtdsMUID) ";
        SQL += "SELECT date_add(now(),interval -"+iDay+" day), ";
        SQL += "gtlGoldType,gtlSource,sum(gtlTycTax),sum(gtlAmount) ";
        SQL += ",avg(gtlGoldRate),gtlMUID ";
        SQL += "FROM tblGoldTranLog ";
        SQL += "where DATE(gtlDate) = DATE(NOW() - INTERVAL "+iDay+" DAY) ";
        SQL += "group by gtlMUID,gtlGoldType,gtlSource,gtlSrcID";
        con.query(SQL, function (err, result, fields) {
          if (err) console.log(err);
          else console.log( "\nSummerizing Days transactions...\n");
        });
      }
    }
    doMonthSum();
  });
}
function doMonthSum(){
  console.log('update Month sum log');
  SQL = "select count(*)nRec FROM tblGoldTranMonthSum where DATE(gtmsDate) = DATE(NOW() - INTERVAL 1 MONTH)";
  console.log(SQL)
  con.query(SQL, function (err, result, fields) {
    if (err) console.log(err);
    else {
      const rec = result[0];
      if (rec.nRec == 0) {
        SQL  = "insert into tblGoldTranMonthSum (gtmsDate,gtmsGoldType,gtmsSource,gtmsTycTax, ";
        SQL += "gtmsAmount,gtmsGoldRate,gtmsMUID) ";
        SQL += "SELECT date_add(now(),interval -1 month), ";
        SQL += "gtlGoldType,gtlSource,sum(gtlTycTax),sum(gtlAmount) ";
        SQL += ",avg(gtlGoldRate),gtlMUID ";
        SQL += "FROM tblGoldTranLog ";
        SQL += "where month(gtlDate) = month(NOW() - INTERVAL 1 MONTH) ";
        SQL += "and year(gtlDate) = year(NOW() - INTERVAL 1 MONTH) "; 
        SQL += "group by gtlMUID,gtlGoldType,gtlSource,gtlSrcID";
        con.query(SQL, function (err, result, fields) {
          if (err)console.log(err);
          else console.log( "\nSummerizing Months transactions...\n");
        });
      }
    }
  });
}
function setTransBlockNumbers(maxBRecs){
   return new Promise( (resolve,reject)=>{
     var prom = this;   
     console.log( "\n *** check tblGoldTrans for null block records on db: ");
    //console.log(maxBRecs);
     SQL  = "select count(*)nRec from tblGoldTrans ";
     SQL += "where gtrnBlockID is null";
    //console.log( "\n"+SQL);
     con.query(SQL, async function (err, result, fields) {
       if (err) {console.log(err);prom.reject(err);}
       else {
         if (result[0].nRec > maxBRecs) {
           SQL  = "SELECT gtrnBlockID  FROM mkyBank.tblGoldTrans ";
           SQL += "group by gtrnBlockID ";
           SQL += "union ";
           SQL += "SELECT gtlBlockID  FROM mkyBank.tblGoldTranLog ";
           SQL += "group by gtlBlockID ";
           SQL += "order by gtrnBlockID desc limit 1 ";
          //console.log( "\n"+SQL);
           con.query(SQL, async function (err, result, fields) {
             if (err) console.log(err);
             else {
               if (result.length  > 0) {
                 rec = result[0];
                 lastBLID = rec.gtrnBlockID;
                 await updateBlock(lastBLID +1,maxBRecs);
                 resolve(lastBLID);
               }
               else {
                 await updateBlock(1,maxBRecs);
                 resolve(0);
               }
             } 
           });
         }
       }
     });
   });
}
function updateBlock(id,limit){
   //*** Update blockIDs
   if (limit){
     limit = ' order by gtrnDate,gtrnSyncKey limit ' + limit;
   }
   else limit = '';
   return new Promise( (resolve,reject)=>{
     SQL  = "update  tblGoldTrans set gtrnBlockID = " + id + " ";
     SQL += "where gtrnBlockID is null " + limit;
     console.log("\n"+SQL);
     con.query(SQL, function (err, result, fields) {
       if (err) {console.log(err),reject(err);}
       else {
         resolve('OK');
       }
     });
   });
}

