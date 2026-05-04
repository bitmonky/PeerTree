#!/bin/bash
curl https://admin.bitmonky.com/bitMDis/peerTree.js          -o peerTree.js
curl https://admin.bitmonky.com/bitMDis/peerCrypt.js         -o peerCrypt.js
curl https://admin.bitmonky.com/bitMDis/addslashes.js        -o addslashes.js
curl https://admin.bitmonky.com/bitMDis/mkyDatef.js          -o mkyDatef.js
curl https://admin.bitmonky.com/bitMDis/networkWebConsole.js -o networkWebConsole.js
curl https://admin.bitmonky.com/bitMDis/bitWebMoniter.js     -o bitWebMoniter.js
curl https://admin.bitmonky.com/bitMDis/shardTreeTpl.sql     -o /mnt/db/dumps/shardTreeTpl.sql
curl https://admin.bitmonky.com/bitMDis/shardTreeCell.js     -o shardTreeCell.js
curl https://admin.bitmonky.com/bitMDis/shardTreeObj.js      -o shardTreeObj.js
curl https://admin.bitmonky.com/bitMDis/ftreeFileMgrCell.js  -o ftreeFileMgrCell.js
curl https://admin.bitmonky.com/bitMDis/ftreeFileMgrObj.js   -o ftreeFileMgrObj.js
curl https://admin.bitmonky.com/bitMDis/ftreeFileMgrTpl.sql  -o /mnt/db/dumps/ftreeFileMgrTpl.sql
curl https://admin.bitmonky.com/bitMDis/pstartftreecell.sh   -o pstartftreecell.sh

#sed -i "s/user: \"username\"/user: \"shUsername\"/g" /peerTree/ftreeFileMgrObj.js
#sed -i "s/password: \"password\"/password: \"shPassword\"/g" /peerTree/ftreeFileMgrObj.js

chmod 774 p*.sh
chmod 644 keys/fullchain.pem
chmod 600 keys/privkey.pem

rm ftreeFileMgrCellNodeErrors.log
 
echo $1
node ftreeFileMgrCell 139.177.195.184 
