/*PHP
Example code for connecting to your local peerMemory or peerShard cell receptor.
*/
function ptreeMakeSearchKey($j){
  return hash('sha256',json_encode($j));
}
$PTC_myRECEPTOR = "https://<Your Nodes IP>:1335";

function ptreeStoreShard($muid,$hash,$shard,$nCopys=3,$expires=null){
   $j = new stdClass;
   $j->from    = $muid;
   $j->hash    = $hash;
   $j->data    = $shard;
   $j->expires = $expires;
   $j->nCopys  = $nCopys;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_myRECEPTOR']."/netREQ";
   $post->postd = 'msg='.urlencode('{"req":"storeShard","shard":'.json_encode($j).'}');

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ptreeRequestShard($muid,$hash,$shard,$nCopys=3,$expires=null){
   $j = new stdClass;
   $j->ownerID = $muid;
   $j->hash    = $hash;

   $url = $GLOBALS['PTC_myRECEPTOR'].'/netREQ/msg='.urlencode('{"req":"requestShard","shard":'.json_encode($j).'}');
   $bcRes = tryFetchURL($url,1);
   return $bcRes;
}
function ptreeSearchMem($muid,$str,$type='acHashTag'){
   $j = new stdClass;
   $j->ownerID   = $muid;
   $j->qryStr    = $str;
   $j->qryType   = $type;
   $j->qryStyle  = 'bestMatch';
   $j->timestamp = time();
   $j->reqScore  = 0.0005;
   $j->nResults  = 100;
   $j->nRows     = 15;

   $j->pg        = 1;
   $j->key       = ptreeMakeSearchKey($j);

   $url = $GLOBALS['PTC_myRECEPTOR'].'/netREQ/msg='.urlencode('{"req":"searchMemory","qry":'.json_encode($j).'}');
   $bcRes = tryFetchURL($url,1);
   return $bcRes;
}
function ptreeStoreMem($muid,$acID,$str,$type='generic',$nCopys=3){
   $j = new stdClass;
   $j->from    = $muid;
   $j->memID   = $acID;
   $j->memStr  = $str;
   $j->memType = $type;
   $j->nCopys  = $nCopys;

   $url = $GLOBALS['PTC_myRECEPTOR'].'/netREQ/msg='.urlencode('{"req":"storeMemory","memory":'.json_encode($j).'}');
   $bcRes = tryFetchURL($url,1);
   return $bcRes;
}
function tryJFetchURL($j,$method='GET',$timeout=5){
    $resp = new stdClass;
    $crl = curl_init();
    curl_setopt ($crl, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt ($crl, CURLOPT_URL,$j->url);
    curl_setopt ($crl, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt ($crl, CURLOPT_CONNECTTIMEOUT, $timeout);
    curl_setopt ($crl, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt ($crl, CURLOPT_USERAGENT,$_SERVER['HTTP_USER_AGENT']);
    curl_setopt ($crl, CURLOPT_MAXREDIRS,5);
    curl_setopt ($crl, CURLOPT_REFERER, 'https://monkytalk/');
    curl_setopt ($crl, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);
    if ($method == 'POST'){
      $j->post = "sending post data:".$j->postd;
      curl_setopt ($crl, CURLOPT_POSTFIELDS, $j->postd);
    }

    $resp->data  = curl_exec($crl);
    $resp->furl  = curl_getinfo($crl, CURLINFO_EFFECTIVE_URL);
    $resp->error = false;
    if (!curl_errno($crl)) {
      $info = curl_getinfo($crl);
      $resp->rcode = $info['http_code'];
    }
    else {
      $resp->error = true;
    }
    curl_close($crl);
    return $resp;
}
