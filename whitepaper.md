# PeerTree
## A Peer-To-Peer Cloud Storage And Information Retrieval System.

A Peer-To-Peer Cloud Storage And Information Retrieval System.
A project by Peter Tilkov
shardnet.bitmonky.com


## Background

This proposed solution to distributed cloud storage is a system where no singular entity owns the cloud. Similar to Bitcoin, the cloud is made up of trustless nodes in a peer-to-peer network. However, unlike Bitcoin, the cloud is not a blockchain where everyone keeps a copy of a ledger. Instead, information will be ripped into shards and stored randomly on nodes across the network.

To retrieve a file, you need only keep the hash of the data and a sequential list of hashes for each shard of the file. Then, to read the file from the network, you send a broadcast request for a shard using the hash. Nodes on the network that have a saved copy of the shard will respond to your request and send you the data. To verify that the data is correct, the requester only has to hash the data retrieved and compare it to the hash used in the original request.

## Introduction
Cloud computing on the Internet has come to rely almost exclusively on large institutions serving as trusted third parties. While the system works very well from a technical perspective, it still suffers from the inherent weaknesses of all large entities. They become monopolies. Everyone understands what that implies, so I will not digress. What is needed is a distributed cloud architecture based on cryptographic proof instead of trust, allowing data to be stored randomly across many nodes that are not under the control of any individual. Shards of data can be encrypted to avoid information leakage, and the contents of an entire file can only be assembled by the file owner(s). Sending a file becomes as simple as sending the hash of the file along with the sequential list of sharded data hashes.

## The Network
A self-organizing peer-to-peer network where Peers can send and receive and broadcast JSON messages using HTTPS: using only self-signed certs. Messages are digitally signed by each node using EC private-public key pairs. The peers form a tree structure where new nodes are added from left to right. The first node is the root of a tree. Each node keeps a list of the root peer group and its own peer group. Nodes that leave or time out are replaced by the last node to join. Messages that can not be sent are pushed onto a queue and are delivered as soon as the connection returns, or the node is replaced.

Work has yet to be started on the shardnet application.

## File Storage
To store a file in the cloud, one needs to be a member node in the network.
Encrypt the file (optional), hash the file, and store the hash.
Rip the file into shards hashing each shard.
Your node will have a database of all other nodes in the network. Randomly select n nodes from the database (where n is the redundancy required for each shard).
Broadcast the shard to those nodes and listen for a response from each node. If any requests are denied or time out, send out (n - fq) more random requests where fq is the number of failed requests
Repeat until all shards are successfully stored, then save locally your files hash and the shard hash list {fileHash: string, filename:string,[ sequence: number, hash: string]}

## File Retrieval
Open the file you saved locally and read the fileHash and the list of shards
Iterate through the list and broadcast the hash for each hash to the entire network
Nodes that have the required shard stored will notify you that they have the data.
Pick the first responder and ask that peer for the data directly.
Check each of the responders' returned data by hashing the response data and matching it to your hash for that shard.
Once all shards have been retrieved, stitch them together into a single file.
Finally, do a hash sum check on the entire file to ensure that your file is complete.

## Distributed Search
ShardNet can also be applied to search large volumes of documents. We do this as follows:
First, a relational database is used to build a metadata index. In the index, information is stored about the document's location. For example, web page document {url}, or relational data information { key field: recID, table: table name}
The following is required to prepare this information for search storage on the PeerTree distributed network.
Create and store a checksum hash for the data package (we will call this a memory item).
Prepare the data in a JSON string, including the checksum hash.
Broadcast the memory to a random selection of n peers on the network.
Finally, Listen for successful responses from all the peers (same as the file store method above). Save the memory checksum in your relational database.

## Memory Storage Method On Peer Nodes
Peers will parse the JSON and create a relational table to store all the words in each memory package. {hash: (the memory hash), wordList: [{word:(words from metadata provided)]}
Store the list in the nodes' relational database and respond with success or failure.
Failure in this instance indicates that a node is full and is not accepting any new data until it becomes available again.

## Executing A Search
Prepare a request using the search str. {searchID: unique, searchStr: string}
Broadcast the search to all peers.
Each node on the network will do a relational search, grouping the search by memoryID, word. Selecting for (memoryID, nWordsMatching/nWordsTotal). And send a response that consists only of memory(s) with a high score or no response for an empty list.
The node that made the search request will get back only responses from peers that found relevant (high-scoring results);
Use this short list to retrieve your data from your relational database, sorted in descending order by score.

# Conclusion
