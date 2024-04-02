<?php
//  ini_set('display_errors',1);
//  error_reporting(E_ALL);
$requestHeaders = getallheaders();
$requestBody = file_get_contents('php://input');

$url = '';
if (isset($_SERVER['REQUEST_URI'])) {
  $url = $_SERVER['REQUEST_URI'];
  //echo "Current script name: $url\n";
}  
$parsedUrl = parse_url($url);
// Extract components
$path = $parsedUrl['path'];
//echo "oldpath:".$path."\n";
$filename = basename($path);
$queryData = isset($parsedUrl['query']) ? $parsedUrl['query'] : null;
$path = str_replace('/'.$filename,'',$path);

$j = new stdClass;
$j->url = 'https://gsi.guerrillasoft.org/peerCacheFile.php?path='.urlencode(ltrim($path)).'&filename='.urlencode($filename);
$res = tryJFetchURL($j);
$js = json_decode($res->data);

if ($js->result  == false){
  fail("File `$path/$filename` Not Found On PeerTree Network ERR => ".$js->error);
}
$file = json_decode($js->data);

// Excute The File Retrieved From PeerTree And Redirect the browser

$targetUrl = 'https://gsi.guerrillasoft.org/webtree/'.(ltrim($path,'/')).'/'.$filename;

$timeout = 20;
$ch = curl_init();
curl_setopt ($ch, CURLOPT_URL,$targetUrl);
//curl_setopt($ch, CURLOPT_HTTPHEADER, $requestHeaders);
curl_setopt ($ch, CURLOPT_SSL_VERIFYHOST, 0);
curl_setopt ($ch, CURLOPT_SSL_VERIFYPEER, 0);
curl_setopt ($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt ($ch, CURLOPT_CONNECTTIMEOUT, $timeout);
curl_setopt ($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt ($ch, CURLOPT_MAXREDIRS,5);
curl_setopt ($ch, CURLOPT_REFERER, 'https://guerrillasoft.org/');
curl_setopt ($ch, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);

// Check if it's a POST request
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $requestBody);
}

// Execute the cURL request
curl_setopt ($ch, CURLOPT_URL,$targetUrl);
$response = curl_exec($ch);

// Check for errors
if (curl_errno($ch)) {
    echo 'cURL error: ' . curl_error($ch);
} else {
   header("Content-Type: ".$file->fileInfo->fileType);
   echo $response;
}
curl_close($ch);

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

function fail($msg){
  ?>

  <!doctype html>
  <html class="pgHTML" lang="en">
  <head>
    <meta charset="utf-8"/><link rel="stylesheet" href="https://web.bitmonky.com/whzon/pc.css?v=1.0"/>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=2, user-scalable=1,target-densitydpi=device-dpi" />
  </head>
  <body class="pgBody" style="margin:5%;margin-top:2.5em;padding:1.5em;border-radius:0.24em;">
    <img style="float:left;margin:-3em 1em -1em -1em;height:5em;width:5em;border-radius:50%;" 
         src="https://image.bitmonky.com/img/bitGoldCoin.png">
    <div align="right" ID="loginSpot">
    <input ID="goBack" type="button" value=" Go Back " onClick="history.back()"/>
    <input ID="home" type="button" value=" BitMonky Home " onClick="top.document.location.href='/';"/>
    </div>
    <h1>Woops Some Thing Went Wrong</h1>
    <?php echo $msg;?>
    <div ID="accountInfo"></div>
    <div ID="serviceMenu"></div>
    <div ID="serviceView"></div>
   </body>
   </html>
   <?php
   exit('');
}
?>
