<?php 
  //ini_set('display_errors',1);
  //error_reporting(E_ALL);
  $PTC_shardRECEPTOR = 'https://localhost:13355';
  $PTC_ftreeRECEPTOR  = "https://172.105.5.29:13361";
  
  $mbrMUID = "1HmH6qPXf1sFpw45GwMSW9RbZByZAVPHhK";
  $repo = "Bitmonky";
  if (isset($_GET['path'])){
    $path = $_GET['path'];
  }
  else {  
    $path = "/";
  }
  if (isset($_GET['filename'])){
    $file = $_GET['filename'];
  }
  else {
    fail("No Filename In Request");
  }
  $encrypt = 0;
  $folderID = null;
  
  $fd  =  ftreeGetFileFromRepo($mbrMUID,$repo,$file,$path,$folderID);
  if (!$fd){
    fail('Node::ftreeGetFileFromRep:Failed');
  }
  $f = $fd->data;
  
  $f = json_decode($f);
  if (!$f->result){
    fail($fd->data.' Not Found');
  }
  $FILE = json_encode($f->file);
 
  $fcheckSum = $f->file->fileInfo->checkSum;
  $r = fetch($FILE);
  if ($r){
    fetchDependentFiles($r->text);	  
    respond($r->file);
  }
  fail('fetch::File Not Available');

function fail($msg){
  $j = new stdClass;
  $j->result = false;
  $j->error  = $msg;
  exit(json_encode($j));
}
function respond($data=null){
  $j = new stdClass;
  $j->result = true;
  $j->data   = $data;
  exit(json_encode($j));
}  
function fetchDependentFiles($fText){
  $dep = getIncludes($fText);
  forEach($dep as $fname){
    //fetch dependant file from PeerTree and write to webtree cache.
  };
}
function fetchSubFile($url,$subfile){
  $url  = removeDotPrefix($url);
  $parsedUrl = parse_url($url);
  $path = $parsedUrl['path'];
  $filename = basename($path);
  $queryData = isset($parsedUrl['query']) ? $parsedUrl['query'] : null;

  $path = str_replace('/'.$filename,'',$path);
  $p = explode('/',$path);
  $p = array_filter($p);
  return removeRelative($subfile,$p);
}
function removeDotPrefix($str) {
  if (strpos($str, './') === 0) {
    return substr($str, 1);
  }
  return $str;
}
function removeRelative($str,$p) {
  $count = 0;
  while (strpos($str, '../') === 0) {
    $str = substr($str, 3);
    $count++;
  }
  return trimPath($p,$count).$str;
}
function trimPath($inputArray, $n) {
  if ($n >= count($inputArray)) {
    return '/';
  }
  $ap = array_slice($inputArray, 0, -$n);
  $p = '/';
  forEach($ap as $folder){
    $p .= $folder.'/';
  }
  return $p;
}
function pfetch($FILE){
   $f = json_decode($FILE);
   $fdata = null;
   forEach($f->shards as $s){
     $j = ptreeRequestShard($f->owner,$s->shardID,null);
     $data = str_replace('"{','{',$j->data);
     $data = str_replace('}"','}',$data);
     $jres = json_decode($data);
     $bstr = $jres->data->data;
     $fdata .= base64_decode($bstr);
   }
   $f->filename = ltrim($f->filename,'/'); 
   $floc = $_SERVER["DOCUMENT_ROOT"]."/webtree/".$f->filename;
   writeFileWithDirectory($floc, $fdata);
   $r = new stdClass;
   $r->file = $FILE;
   $r->text = $fdata
   return $r;
}  
function getIncludes($text) {
    $count = preg_match_all('/
        # Match PHP include variations with single string literal filename.
        \b              # Anchor to word boundary.
        (?:             # Group for include variation alternatives.
          include       # Either "include"
        | require       # or "require"
        )               # End group of include variation alternatives.
        (?:_once)?      # Either one may be the "once" variation.
        \s*             # Optional whitespace.
        (               # $1: Optional opening parentheses.
          \(            # Literal open parentheses,
          \s*           # followed by optional whitespace.
        )?              # End $1: Optional opening parentheses.
        (?|             # "Branch reset" group of filename alts.
          \'([^\']+)\'  # Either $2{1]: Single quoted filename,
        | "([^"]+)"     # or $2{2]: Double quoted filename.
        )               # End branch reset group of filename alts.
        (?(1)           # If there were opening parentheses,
          \s*           # then allow optional whitespace
          \)            # followed by the closing parentheses.
        )               # End group $1 if conditional.
        \s*             # End statement with optional whitespace
        ;               # followed by semi-colon.
        /ix', $text, $matches);
    if ($count > 0) {
        $filenames = $matches[2];
    } else {
        $filenames = array();
    }
    return $filenames;
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
function writeFileWithDirectory($filePath, $content) {
    // Extract the directory path from the file path
    $directory = dirname($filePath);

    // Check if the directory exists; if not, create it
    if (!is_dir($directory)) {
        mkdir($directory, 0777, true); // The third parameter ensures recursive directory creation
    }

    // Write the content to the file
    file_put_contents($filePath, $content);
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
    curl_setopt ($crl, CURLOPT_USERAGENT,'peerRepoHTTP_USER_AGENT');
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
