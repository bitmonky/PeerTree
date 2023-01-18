<?php
include_once("peerReceptorAccess.php");
ini_set('display_errors',1);
error_reporting(E_ALL);
$time_pre = microtime(true);

//$MKYC_ShowSQLTimer = true;
//echo "<h2>Starting Test File Storage On PeerTree</h2>\n";

/***********************************
initialize with your shardTree wallet address.
*/
$mbrMUID = "14eVhcReSJQFSxjMVzKZEkzX91TdgUt2V8";
$file    = "/var/www/html/img/bitGoldCoin.png";
$fdata   = null;
$SQL = "select smgrID,smgrCheckSum from tblShardFileMgr where smgrFileName = '".$file."'";
$res = mkyMyqry($SQL);
$rec = mkyMyFetch($res);
if (!$rec){
  exit('File:'.$file.' Not Found');
}


$fcheckSum = $rec['smgrCheckSum'];

$smgrID    = $rec['smgrID'];

$SQL = "select sfilShardHash from tblShardFiles where sfilFileMgrID = '".$smgrID."' order by sfilShardNbr";
$res = mkyMyqry($SQL);
$rec = mkyMyFetch($res);
while($rec){
   $j = ptreeRequestShard($mbrMUID,$rec['sfilShardHash']);
   $data = str_replace('"{','{',$j->data);
   $data = str_replace('}"','}',$data);
   $jres = json_decode($data);
   //echo "<h1>data</h1>";

   //echo "<p/>json:".json_encode($jres);
   $bstr = implode(array_map("chr", $jres->data->data->data));
   $fdata .= base64_decode($bstr);
   $rec = mkyMyFetch($res);
}

header("Accept-Ranges: bytes");
header("Content-Type: image/png");
header("Content-Disposition: inline; filename=\"/fileFromTree.png\";");
echo $fdata;
//echo  "<br/>".hash('sha256',$fdata);
?>

