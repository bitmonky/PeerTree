# mkyNetwork
A self organizing peer to peer network where Peers can send and receive and broadcast JSON messages using https: using only self signed certs. Messages are digitally signed by each node using ec private public key pair The peers form a tree structure where new nodes are added left to right. The first node is the root of a tree. Each node keeps a list of the root peer group and its own peer group. Nodes that leave or timeout are replaced by the last node to join. Messages that can not be sent are pushed onto a queue and are delivered as soon as the connection returns or the node is replaced.

The project also includes a proof of concept blockchain application that runs on top
of the mkyNetwork object.

you can check out a working demo of the blockchain app 
here 

https://www.bitmonky.com/whzon/bitMiner/webConsole.php?git=git

If you would like to support the projet financially consider 
purchasing some coins from the <a href='https://bitmonky.com/whzon/wzApp.php?furl=https://www.bitmonky.com/whzon/gold/mrkViewGJEX.php'>GJEX</a> market place on bitmonky.com
