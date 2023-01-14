/***************************************************
Class To Manage Muliple search results keep track of
searchs based on the search key 

Sample search: (PHP)
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
   $j->key       = ptreeMakeSearchKey($j); //sha256 hash

====================================================
*/ 
class pSearchMgr{
   constructor(){
     this.searches = [];
   }
   /***********************************************
   isThere - gets the index for a gien searc key.
   If not found creatres and ads it to the list
   */
   isThere(qry){
     const inId = qry.key;
     var i = null;
     this.searches.every((item,n) =>{
       if (item.id == inId){
         i = n;
         return false;
       } 
       return true;
     });
     if(i === null){
       this.searches.push({id:inId,time: qry.timestamp,data : []});
       return this.searches.length -1;
     }
     return i;
   }
   /*****************************************
   add a list of results to existing list by
   iterating through the 'results' pushing them onto the end.
   when done 'qsort' the full list.
   */
   qpush(qry,results){
   }
   qsort(qry){
     const qIndex = this.isThere(qry);
     this.searches[qIndex].data;    
     this.searches[qIndex].data.sort((a, b) => {
       const scoreA = a.score; 
       const scoreB = b.score; 
       if (scoreA < scoreB) {
         return -1;
       }
       if (scoreA > scoreB) {
         return 1;
       }
       // scores must be equal
       return 0;
     });
   }
};

// Create a new search manager class
var smgr = new pSearchMgr;

// Create a sample search
var qry = {
  key  : 'xyz',
  timestamp : 34324324343,
  qryStr    : 'some words to find',
  data : [] // results list from a search; 
}
// Create a list of search results
var items = [];
items = [
  { name: "Edward",  score: 0.21 },
  { name: "Sharpe",  score: 0.37 },
  { name: "And",     score: 0.45 },
  { name: "The",     score: 0.12 },
  { name: "Magnetic",score: 0.13 },
  { name: "Zeros",   score: 0.37 },
];

// Add  a search result to the list
items.push({name:"warpigs",score : 0.0123});

// Assign the items list to be the data set of the current search
qry.data = items;
console.log('unsorted results are ->',qry.data);

// add it to the search manager and get its index number;
qIndex = smgr.isThere(qry);

// push the items into the results list for the search
smgr.qpush(qry,items);

console.log('qry index is',qIndex);
console.log('qry is->',smgr.searches[qIndex]);

// Sort the list
smgr.qsort(qry);
// Display the list
console.log('Sorted Result List is ->',smgr.searches[qIndex]);
