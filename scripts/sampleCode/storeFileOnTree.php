<?php
include_once("peerReceptorAccess.php");
ini_set('display_errors',1);
error_reporting(E_ALL);
$time_pre = microtime(true);

echo "<h2>Starting Test File Storage On PeerTree</h2>\n";

/***********************************
initialize with your shardTree wallet address.
*/
$mbrMUID = "14eVhcReSJQFSxjMVzKZEkzX91TdgUt2V8";

$start = 0;
$size = 16000; // set shard size

/* Open file you wish to store to the PeerTree
*/
$file = "/var/www/html/img/mkyHomeBan.png";
$contents = file_get_contents($file);

$fcheckSum = hash('sha256',$contents);   // Create sha256 hash of the file.

$cimg = null;
$n=1;

while ($chunk = substr($contents, $start, $size))   {
    // Process
    $schunk = $chunk;
    $shard  = base64_encode($schunk);
  
    // Creat a hash for storing and retrieving the shard
    $shardh = hash('sha256',$chunk);

    // Check to see if the shard has already been stored.
    $SQL = "select count(*)nRec from ICDirectSQL.tblShardFiles where sfilCheckSum = '".$fcheckSum."' and sfilShardHash = '".$shardh."'";
    $res = mkyMyqry($SQL);
    $rec = mkyMyFetch($res);
    if ($rec['nRec'] == 0){
      // Make the storage request to your shard cells receptore;
      $j = ptreeStoreShard($mbrMUID,$shardh,$shard,$nCopys=3,$expires=null);

      $jres = json_decode($j->data);
      echo "<br/>result".$jres->result;
      echo "<br/>nStored".$jres->nStored;
      if ($jres->result == "shardOK" && $jres->nStored == 1){
        //* save the shard into your collection of sharded files
        $SQL  = "insert into ICDirectSQL.tblShardFiles ";
        $SQL .= "(sfilCheckSum,sfilShardHash,sfilNCopies,sfilDate,sfilExpires,sfilEncrypted) ";
        $SQL .= "values ('".$fcheckSum."','".$shardh."',3,now(),null,null)";
        mkyMyqry($SQL);
      }
    }
    $n = $n +1;
    $start +=$size;
}
echo 'Done... File Stored is : ".$fcheckSum;
