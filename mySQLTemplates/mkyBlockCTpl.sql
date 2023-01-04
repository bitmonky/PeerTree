-- MySQL dump 10.14  Distrib 5.5.60-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: mkyBlockCTpl
-- ------------------------------------------------------
-- Server version	5.5.60-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `tblmkyBlockChain`
--

DROP TABLE IF EXISTS `tblmkyBlockChain`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblmkyBlockChain` (
  `bchaID` bigint(20) NOT NULL AUTO_INCREMENT,
  `bchaDifficulty` int(11) DEFAULT NULL,
  `bchaReward` float DEFAULT NULL,
  `bchaName` varchar(145) CHARACTER SET latin1 DEFAULT NULL,
  `bchaAuthority` bigint(20) DEFAULT NULL,
  `bchaCatalog` varchar(145) CHARACTER SET latin1 DEFAULT NULL,
  `bchaSrcTable` varchar(145) CHARACTER SET latin1 DEFAULT NULL,
  `bchaStatus` varchar(45) DEFAULT NULL,
  `bchaBranchID` varchar(45) DEFAULT NULL,
  `bchaMaxBlockSize` bigint(20) DEFAULT NULL,
  `bchaLastTick` int(11) DEFAULT NULL,
  PRIMARY KEY (`bchaID`),
  KEY `bchaStatus` (`bchaStatus`),
  KEY `bchaSrcTable` (`bchaSrcTable`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblmkyBlockChain`
--

LOCK TABLES `tblmkyBlockChain` WRITE;
/*!40000 ALTER TABLE `tblmkyBlockChain` DISABLE KEYS */;
INSERT INTO `tblmkyBlockChain` VALUES (1,4,1000,'Branch 02 Banking Ledger',63555,'mkyBank','tblGoldTranLog','Online','2',NULL,NULL),(2,4,1000,'Branch 2 Transactions ',63555,'mkyBank','tblGoldTrans','Online','2',NULL,NULL),(3,4,1000,'Branch 2 Daily Sum',63555,'mkyBank','tblGoldTranDaySum','Online','2',NULL,NULL),(4,4,1000,'Branch 2 Monthly Sum',63555,'mkyBank','tblGoldTranMonthSum','Online','2',NULL,NULL),(5,5,1000,'Branch 2 Wallets',63555,'mkyBank','tblmkyWallets','Online','2',NULL,NULL);
/*!40000 ALTER TABLE `tblmkyBlockChain` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblmkyBlockTrans`
--

DROP TABLE IF EXISTS `tblmkyBlockTrans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblmkyBlockTrans` (
  `tranID` bigint(20) NOT NULL AUTO_INCREMENT,
  `tranBlockChainID` bigint(20) DEFAULT NULL,
  `tranBlockID` bigint(20) DEFAULT NULL,
  `tranBlockData` longblob,
  PRIMARY KEY (`tranID`),
  KEY `tranBlockChainID` (`tranBlockChainID`),
  KEY `tranBlockID` (`tranBlockID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblmkyBlockTrans`
--

LOCK TABLES `tblmkyBlockTrans` WRITE;
/*!40000 ALTER TABLE `tblmkyBlockTrans` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblmkyBlockTrans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblmkyBlocks`
--

DROP TABLE IF EXISTS `tblmkyBlocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblmkyBlocks` (
  `blockID` bigint(20) NOT NULL AUTO_INCREMENT,
  `blockNbr` bigint(20) DEFAULT NULL,
  `blockHash` varchar(250) DEFAULT NULL,
  `blockPrevHash` varchar(250) DEFAULT NULL,
  `blockNOnce` bigint(20) DEFAULT NULL,
  `blockTimestamp` bigint(20) DEFAULT NULL,
  `blockChainID` bigint(20) DEFAULT NULL,
  `blockMinerID` bigint(20) DEFAULT NULL,
  `blockDifficulty` int(11) DEFAULT NULL,
  `blockHashTime` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`blockID`),
  KEY `blockNbr` (`blockNbr`),
  KEY `blockChainID` (`blockChainID`),
  KEY `blockMinerID` (`blockMinerID`),
  KEY `blockHashTime` (`blockHashTime`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblmkyBlocks`
--

LOCK TABLES `tblmkyBlocks` WRITE;
/*!40000 ALTER TABLE `tblmkyBlocks` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblmkyBlocks` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2021-08-15  2:00:01
