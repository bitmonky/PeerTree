<?php
function ptreeMakeSearchKey($j){
  return hash('sha256',json_encode($j));
}
$PTC_memRECEPTOR    = "https://139.144.110.5:1335";
$PTC_shardRECEPTOR  = "https://170.187.179.251:13355";
$PTC_shardRECEPTOR2 = "https://139.144.110.5:13355";
$PTC_ftreeRECEPTOR  = "https://172.105.5.29:13361"; 
$PTC_maxWordLength  = 45;
include_once('peerMemComWordsInc.php');
function prepWords($str){
  if ($str === null || mkyTrim($str) == ''){
    return null;
  }
  $str = ' '.$str.' ';

  $words = json_decode($GLOBALS['comWords']);
  forEach($words as $word){
    //echo $word->word.", ";
    $str = str_ireplace(' '.$word->word.' ',' ',$str);
  }
  $str = mkyTrim($str);
  $str   = preg_replace("/[\p{P}\p{S}]+/u", " ", $str);
  $str   = mb_strtolower($str);
  $str   = str_replace(" s ",'s ',$str);

  // Shorten long words
  $list  = explode(' ',$str);
  $n=0;$newStr = null;
  forEach ($list as $word){
    $word = left($word,$GLOBALS['PTC_maxWordLength']);
    if ($n==0){
      $n=1;
      $newStr = $word;
    }
    else {
      if (mkyTrim($word) != ''){
        $newStr .= ' '.$word;
      }
    }
  } 
  if (strlen($newStr)==0){
    return null;
  }
  return $newStr;
}
function ftreeCreateRepo($muid,$name,$nCopys){
   $j = new stdClass;
   $j->from      = $muid;
   $j->name      = $name;
   $j->nCopys    = 0 + $nCopys;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"createRepo","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ftreeCreateRepoFolder($muid,$name,$folder,$parent){
   $j = new stdClass;
   $j->from      = $muid;
   $j->name      = $name;
   $j->folder    = $folder;
   $j->parent    = $parent;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"createRepoFolder","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}	
function ftreeGetMyRepos($muid){
   $j = new stdClass;
   $j->from      = $muid;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"getMyRepoList","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ftreeGetMyRepoPath($muid,$name,$fname,$folderID){
   $j = new stdClass;
   $j->from     = $muid;
   $j->name     = $name;
   $j->fname    = $fname;
   $j->folderID = $folderID;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"getMyRepoFilePath","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ftreeGetMyRepoFiles($muid,$name,$fparentID=null){
   $j = new stdClass;
   $j->from      = $muid;
   $j->name      = $name;
   $j->parentID  = $fparentID;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"getMyRepoFiles","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ftreeGetFileFromRepo($muid,$name,$file,$path,$folderID){
   $j = new stdClass;
   $j->from      = $muid;
   $j->name      = $name;
   $j->file      = $file;
   $j->path      = $path;
   $j->folderID  = $folderID;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"getRepoFileData","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ftreeInsertFileToRepo($muid,$name,$file,$path,$folderID,$nCopys){
   $j = new stdClass;
   $j->from      = $muid;
   $j->name      = $name;
   $j->file      = $file;
   $j->path      = $path;
   $j->folderID  = $folderID;
   $j->nCopys    = 0 + $nCopys;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"insertRSfile","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ftreeDeleteFileFromRepo($muid,$name,$file,$path,$nCopys){
   $j = new stdClass;
   $j->from      = $muid;
   $j->name      = $name;
   $j->file      = $file;
   $j->path      = $path;
   $j->nCopys    = 0 + $nCopys;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_ftreeRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"deleteRSfile","repo":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ptreeStoreShard($muid,$hash,$shard,$encrypt=null,$nCopys=3,$expires=null){
   if ($encrypt == 0){
     $encrypt = null;
   }	
   $j = new stdClass;
   $j->from      = $muid;
   $j->hash      = $hash;
   $j->data      = $shard;
   $j->encrypt   = $encrypt;
   $j->expires   = $expires;
   $j->nCopys    = 0 + $nCopys;

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
   //$post->url   = $GLOBALS['PTC_shardRECEPTOR2']."/netREQ";
   $post->postd = '{"msg":{"req":"requestShard","shard":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ptreeDeleteShard($muid,$hash,$encrypted=null,$nCopys=3){
   $j = new stdClass;
   $j->ownerID   = $muid;
   $j->hash      = $hash;
   $j->nCopys    = 0 + $nCopys;

   $post = new stdClass;
   $post->url   = $GLOBALS['PTC_shardRECEPTOR']."/netREQ";
   $post->postd = '{"msg":{"req":"deleteShard","shard":'.json_encode($j).'}}';

   $bcRes = tryJFetchURL($post,'POST');
   return $bcRes;
}
function ptreeSearchMem($muid,$str,$type,$scope=null,$scopeID=null,$qryLimit=null,$qryOrder=null){
     
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
   if ($scope){
     $j->scope   = $scope;
     $j->scopeID = $scopeID;
   }  
   $j->qryLimit = ' limit 40';
   if ($qryLimit){
     $j->qryLimit = $qryLimit;
   }
   
   if ($qryOrder){
     $j->qryOrder = $qryOrder;
   }
   $j->key       = ptreeMakeSearchKey($j);

   $u = new stdClass;
   $u->url = $GLOBALS['PTC_memRECEPTOR'].'/netREQ/msg='.mkyUrlEncode('{"req":"searchMemory","qry":'.json_encode($j).'}');
   $bcRes = tryFetchURL($u->url,1);
   return $bcRes;
}
function ptreeStoreMem($muid,$acID,$str,$type='generic',$nCopys=3,$weights=null,$location=null){
   $j = new stdClass;
   $j->from    = $muid;
   $j->memID   = $acID;
   $j->memStr  = $str;
   $j->memType = $type;
   $j->nCopys  = $nCopys;
   $j->weights = $weights;
   if ($location){
     $j->cityID        = $location->cityID;
     $j->stateID       = $location->stateID;
     $j->countryID     = $location->countryID;
     $j->worldRegionID = $location->worldRegionID;
     $j->date          = $location->date;
   }  
   $u = new stdClass;
   $u->url = $GLOBALS['PTC_memRECEPTOR'].'/netREQ/msg='.mkyUrlEncode('{"req":"storeMemory","memory":'.json_encode($j).'}');
   //echo 'LOGING{"req":"storeMemory","memory":'.json_encode($j).'}';
   $bcRes = tryFetchURL($u->url,1);
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
    curl_setopt ($crl, CURLOPT_USERAGENT,safeSRV('HTTP_USER_AGENT'));
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
    if ($resp->data === null) {
      $resp->data = "Document tryJFetchURL  ".$j->url." Failed";
    }

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
