# mkyNetwork
An experimental self organizing peer to peer network in node.js 

Peers can send and receive and broadcast JSON msgs using https:  using
self signed certs. 

Msgs are digitally signed by each node using ec private public key pair

The peers form a tree structure  where new nodes are  
added left to right first node is root of tree.  Each 
node keeps a list of the roots peer group and its own peer group.
  
Nodes that leave or timeout are replaced by the last node to join
Messages that can not be sent are pushed onto a que and
are delivered as soon as the conection returns or the node 
is replaced.

project also includes a proof of concept blockchain application that runs on top
of the mkyNetwork object.

you can check out a working demo of the blockchain app 
here 

https://www.bitmonky.com/whzon/bitMiner/webConsole.php?git=git
