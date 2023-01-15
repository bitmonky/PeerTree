<?php
include_once("peerReceptorAccess.php");

  $time_pre = microtime(true);

  echo "<h2>Storing Random Memory To PeerTree</h1>";

  /*********************************
  Find peer receptor wallet address 'memOwnMUID'
  note* you can find this information in your peerTree nodes /peerTree/key/peerMemToken.key file.
  */
  
  $SQL = "select pmacPMemOwner from tblPeerMemoryAcc";
  $res = mkyMyqry($SQL);
  $rec = mkyMyFetch($res);
  $mbrMUID = $rec['pmacPMemOwner'];

  /**************************
  Select a record in your database that you want to create a memory for.
  In this example the tags field will be the meta data to store on the peerTree.
  */
  $SQL  = "select  activityID,tags from tblActivityFeed ";
  $SQL .= "left join tblActivityMemories on acmeACID = activityID ";
  $SQL .= "where acmeACID is null and NOT tags is null order by rand() limit 1";
  $res = mkyMyqry($SQL);
  $rec = mkyMyFetch($res);
   
  $acmeACID = $rec['activityID'];
  $memStr   = str_replace('#','',$rec['tags']);
  $memHash = hash('sha256', $acmeACID.$memstr);

  /*****************
  Call 'ptreeStoreMem' to send the request to your peerTree memory cells receptor.
  *
  $j = ptreeStoreMem($mbrMUID,$memHash,$memStr,$type='acHashTag');

  /**************
  Display the result.
  */

  $j = json_decode($j);
  echo "result: ".$j->result;
  if ($j->result == "memOK"){
    echo "<br/>nStored: ".$j->nStored;
    echo "<br/>req: ".$j->memory->req;
    echo "<br/>memory: {";
    echo "<br/>  from: ".$j->memory->memory->from;
    echo "<br/>  memStr :".$j->memory->memory->memStr;
    echo "<br/>  memType :".$j->memory->memory->memType;
    echo "<br/>  nCopys :".$j->memory->memory->nCopys;
    echo "<br/>}";
  }  
  /*********************
  Check to see if your memory was stored and on how many nodes.
  If the memory was stored then create an association record in your database.
  for that memories hash.
  */
  if ($j->result == "memOK" && $j->nStored > 0){
    $SQL = "insert into  tblActivityMemories (acmeACID,acmeMemHash,acmeDate) ";
    $SQL .= "values (".$acmeACID.",'".$memHash."',now())";
    $res = mkyMyqry($SQL);
  }

echo "<p/>Job Complete:\n";
$time_post = microtime(true);
$exec_time = $time_post - $time_pre;
echo "Job Run Time: ".$exec_time."\n";
echo "</div>";
?>

