<?php
/**
 * Description of VideoStream
 *
 * @author Rana
 * @link http://codesamplez.com/programming/php-html5-video-streaming-tutorial
 */
$MKYC_ShowSQLTimer = null;

function left($str, $length) {
     return substr($str, 0, $length);
}
include_once("../peerReceptorAccess.php");
include_once("../cleanINC.php");
//ini_set('display_errors',1);
//error_reporting(E_ALL);
$time_pre = microtime(true);

/***********************************
initialize with your shardTree wallet address.
*/
$mbrMUID = "14eVhcReSJQFSxjMVzKZEkzX91TdgUt2V8";
$vfile    = safeGET("fName");
$spoint   = safeGET("spoint");

$vs = new VideoStream($vfile);
if (!$vs->isCached()){
  include_once("../mkyConSqli.php");
}
$vs->start();

class VideoStream
{
    private $path = "";
    private $stream   = "";
    private $nBufShards = 1;
    private $buffer   = 256000;
    private $start    = -1;
    private $end      = -1;
    private $fileSize = 0;
    private $shards   = [];
    private $nShards  = 0;
    private $map      = 0;
    private $fcache   = "/var/www/html/wzAdmin/";
    function __construct($filePath) 
    {
        $this->buffer = $this->buffer * $this->nBufShards;
        $this->path = $filePath;
        $this->fcache = $this->fcache.$filePath.'_cache.tmp';
    }
     
    /**
     * Open stream
     */
    private function dbug($str){
      //$SQL = "insert into streamDBug (dbugData) values ('".$str."')";
      //mkyMyqry($SQL);
    }
    public function isCached(){
      echo $this->fcache;
      if (file_exists($this->fcache)) {
        return true;
      }
      return false;
    }   
    private function writeCache($c){
      $txt = json_encode($c);
      $myfile = fopen($this->fcache, "w");
      if ($myfile){
        if (flock($myfile, LOCK_EX)) {
          fwrite($myfile, $txt);
          flock($myfile,LOCK_UN);
        }
        fclose($myfile);
      }
    }
    private function checkCache(){
      if (file_exists($this->fcache)) {
        $myfile = fopen($this->fcache, "r");
        $contents = fread($myfile,filesize($this->fcache));
        fclose($myfile);
        return json_decode($contents);
      }
      return null;
    }
    private function open()
    {
      $c = $this->checkCache();
      if (!$c){
        $c = new stdClass;
        $SQL = "select smgrID,smgrCheckSum,smgrFileType,smgrFileSize from tblShardFileMgr where smgrFileName = '".$this->path."'";
        $res = mkyMyqry($SQL);
        $rec = mkyMyFetch($res);
        if (!$rec){
           exit('File:'.$file.' Not Found');
        }
        $c->fileSize = $rec['smgrFileSize'];

        $SQL = "select sfilShardHash,sfilEncrypted from tblShardFiles where sfilFileMgrID = '".$rec['smgrID']."' order by sfilShardNbr";
        $res = mkyMyqry($SQL);
        $rec = mkyMyFetch($res);
        if (!$rec){
          exit('File:'.$file.' No Shards Found');
        }
        $n = 0;
        $c->shards = [];
        while ($rec){
          $c->shards[$n]->shardHash = $rec['sfilShardHash'];
          $c->shards[$n]->encrypted = $rec['sfilEncrypted'];
          $rec = mkyMyFetch($res);
          $n = $n + 1;
        }
        $this->writeCache($c);
      }
      $this->nShards  = count($c->shards);
      $this->shards   = $c->shards;
      $this->fileSize = $c->fileSize;
    }
     
    /**
     * Set proper header to serve the video content
     */
    private function setContentHeader(){
      if (!$GLOBALS['spoint']){
        header("Content-Type: video/mp4");
      }
      header("Cache-Control: max-age=2592000, public");
      header("Expires: ".gmdate('D, d M Y H:i:s', time()+2592000) . ' GMT');
      header("Last-Modified: ".gmdate('D, d M Y H:i:s', @filemtime($this->path)) . ' GMT' );
    }
    private function setHeader()
    {
        ob_get_clean();
        $this->start = 0;
        $this->end   = $this->fileSize-1;
        $this->map   = $this->mapIBuf();
        header("Accept-Ranges: 0-".$this->end);
        $this->dbug('http_range:'.$GLOBALS['vfile']);            
        if (isset($_SERVER['HTTP_RANGE']) || $GLOBALS['spoint']) {
            $inRange =  str_replace(' ','',$_SERVER['HTTP_RANGE']); 
            if($GLOBALS['spoint']){
              $inRange = $GLOBALS['spoint'].'-';
            }
            $inRange =  str_ireplace('bytes=','',$inRange);
            if (substr($inRange,-1) == '-'){
              $inRange .= $this->fileSize;
            }
            $ranges = explode('-',$inRange);
            
            if ($ranges[0]  > $ranges[1] || $ranges[0] > $this->fileSize || $ranges[1] > $this->fileSize) {
                header('HTTP/1.1 416 Requested Range Not Satisfiable '.$ranges[0]."-".$ranges[1]."/".$this->fileSize);
                header("Content-Range: bytes ".$ranges[0]."-".$ranges[1]."/".$this->fileSize);
                exit;
            }
            $this->setContentHeader();
            $this->dbug('http_range:'.$_SERVER['HTTP_RANGE']);
            $this->start  = $ranges[0]; // + $this->buffer;
            $this->end    = $ranges[1];
            $this->map = $this->mapIBuf();
            header('HTTP/1.1 206 Partial Content');
            header("Content-Length: ".$this->map->nBytes);
            $this->dbug("Content-Length: ".$this->buffer);
            header("Content-Range: bytes ".$this->start."-".($this->map->end)."/".$this->fileSize);
            $this->dbug("Content-Range: bytes $this->start-$this->end/".$this->fileSize);
        }
        else
        {   
            $this->setContentHeader();
            header("Content-Length: ".$this->fileSize);
        }  
         
    }
    
    /**
     * close curretly opened stream
     */
    private function end()
    {
        exit;
    }
     
    private function readShard($n){
      $j = ptreeRequestShard($GLOBALS['mbrMUID'],$this->shards[$n]->shardHash,$this->shards[$n]->encrypted);
      $data = str_replace('"{','{',$j->data);
      $data = str_replace('}"','}',$data);
      $jres = json_decode($data);
      $bstr = $jres->data->data;
      return base64_decode($bstr);
    }
    private function mapIBuf(){
      $map = new stdClass;
      $map->sNbr    = $this->nShards - floor(($this->fileSize - $this->start)/$this->buffer) -1;
      $map->start   = $map->sNbr * $this->buffer;
      $map->end     = $map->start + $this->buffer -1;
      $map->pointer = $this->start - $map->start;
      $map->nBytes  = $this->buffer - $map->pointer;
      if ($map->sNbr +1 == $this->nShards){
        $overflow = $map->end - $this->fileSize -1;
        $map->end = $this->fileSize -1;
        $map->nBytes  = $map->nBytes - $overflow;
      } 
      return $map;
    }
    /**
     * perform the streaming of calculated range
    */
    private function stream()
    {       
        set_time_limit(0);
        $data = $this->readShard($this->map->sNbr);
        if($GLOBALS['spoint']){
          echo json_encode($this->map);
        }
        echo substr($data,$this->map->pointer,$this->map->nBytes);
        flush();
    }
     
    /**
     * Start streaming video content
     */
    function start()
    {
        $this->open();
        $this->setHeader();
        $this->stream();
        $this->end();
    }
}
?>
