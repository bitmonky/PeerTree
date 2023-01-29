<?php
function ptreeMakeSearchKey($j){
  return hash('sha256',json_encode($j));
}
$PTC_memRECEPTOR   = "https://<your mem node IP>:<port>";
$PTC_shardRECEPTOR = "https://<your shard node IP>:<port>";

function prepWords($str){
  $words = [' i ',' in ',' on ',' there ',' is ',' are ',' as ',' the ',' a ',' to ',' and ',' too ',' of ',' for '];
  forEach($words as $word){
    $str = str_ireplace($word,' ',$str);
  }
  $str   = preg_replace("/(?![.=$'€%-])\p{P}/u", " ", $str);
  $str   = preg_replace("/\W/"," ",$str);
  return $str;
}
function ptreeStoreShard($muid,$hash,$shard,$encrypt=null,$nCopys=3,$expires=null){
   $j = new stdClass;
   $j->from      = $muid;
   $j->hash      = $hash;
   $j->data      = $shard;
   $j->encrypt   = $encrypt;
   $j->expires   = $expires;
   $j->nCopys    = $nCopys;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_shardRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"storeShard","shard":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ptreeRequestShard($muid,$hash,$encrypted=null){
   $j = new stdClass;
   $j->ownerID   = $muid;
   $j->hash      = $hash;
   $j->encrypted = $encrypted;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_shardRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"requestShard","shard":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ptreeDeleteShard($muid,$hash,$encrypted=null){
   $j = new stdClass;
   $j->ownerID   = $muid;
   $j->hash      = $hash;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_shardRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"deleteShard","shard":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
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

   $url = $GLOBALS['PTC_memRECEPTOR'].'/netREQ/msg='.urlencode('{"req":"searchMemory","qry":'.json_encode($j).'}');

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

   $url = $GLOBALS['PTC_memRECEPTOR'].'/netREQ/msg='.urlencode('{"req":"storeMemory","memory":'.json_encode($j).'}');
   $bcRes = tryFetchURL($url,1);
   return $bcRes;
}
function tryJFetchURL($j,$method='GET',$timeout=5){
    $resp = new stdClass;
    $crl = curl_init();
    curl_setopt ($crl, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt ($crl, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt ($crl, CURLOPT_SSL_VERIFYPEER, 0);
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

    curl_setopt ($crl, CURLOPT_HTTPHEADER , array(
      'accept: application/json',
      'content-type: application/json')
    );

    $resp->data  = curl_exec($crl);
    $resp->error = false;
    if ($resp->data === false) {
      $resp->error = curl_error($crl);
    }
    else {
      $info = curl_getinfo($crl);
      $resp->rcode = $info['http_code'];
      $resp->furl  = curl_getinfo($crl, CURLINFO_EFFECTIVE_URL);
    }
    curl_close($crl);
    return $resp;
}
?>
