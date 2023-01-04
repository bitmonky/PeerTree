-- MySQL dump 10.14  Distrib 5.5.60-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: mkyBankTpl
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
-- Table structure for table `tblGoldBranch`
--

DROP TABLE IF EXISTS `tblGoldBranch`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblGoldBranch` (
  `gbrcID` bigint(20) NOT NULL AUTO_INCREMENT,
  `gbrcName` varchar(250) DEFAULT NULL,
  PRIMARY KEY (`gbrcID`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblGoldBranch`
--

LOCK TABLES `tblGoldBranch` WRITE;
/*!40000 ALTER TABLE `tblGoldBranch` DISABLE KEYS */;
INSERT INTO `tblGoldBranch` VALUES (1,'bitMonky Main Branch'),(2,'BGP Public Branch');
/*!40000 ALTER TABLE `tblGoldBranch` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblGoldBranchNode`
--

DROP TABLE IF EXISTS `tblGoldBranchNode`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblGoldBranchNode` (
  `bnodID` bigint(20) NOT NULL AUTO_INCREMENT,
  `bnodBranchID` bigint(20) DEFAULT NULL,
  `bnodIP` varchar(50) DEFAULT NULL,
  `bnodPubKey` varchar(245) DEFAULT NULL,
  `bnodNetName` varchar(80) DEFAULT NULL,
  `bnodStatus` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`bnodID`),
  KEY `gbraBranchID` (`bnodBranchID`),
  KEY `bnodIP` (`bnodIP`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblGoldBranchNode`
--

LOCK TABLES `tblGoldBranchNode` WRITE;
/*!40000 ALTER TABLE `tblGoldBranchNode` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblGoldBranchNode` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblGoldTranDaySum`
--

DROP TABLE IF EXISTS `tblGoldTranDaySum`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblGoldTranDaySum` (
  `gtdsID` bigint(20) NOT NULL AUTO_INCREMENT,
  `gtdsDate` datetime DEFAULT NULL,
  `gtdsGoldType` varchar(50) DEFAULT NULL,
  `gtdsSource` varchar(50) DEFAULT NULL,
  `gtdsTycTax` decimal(24,9) DEFAULT NULL,
  `gtdsAmount` decimal(24,9) DEFAULT NULL,
  `gtdsGoldRate` decimal(28,17) DEFAULT NULL,
  `gtdsMUID` varchar(150) DEFAULT NULL,
  `gtdsBlockNbr` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`gtdsID`),
  KEY `gtdsDate` (`gtdsDate`),
  KEY `gtdsBlockNbr` (`gtdsBlockNbr`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblGoldTranDaySum`
--

LOCK TABLES `tblGoldTranDaySum` WRITE;
/*!40000 ALTER TABLE `tblGoldTranDaySum` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblGoldTranDaySum` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblGoldTranLog`
--

DROP TABLE IF EXISTS `tblGoldTranLog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblGoldTranLog` (
  `gTranLogID` bigint(20) NOT NULL AUTO_INCREMENT,
  `gtlDate` datetime DEFAULT NULL,
  `gtlGoldType` varchar(50) DEFAULT NULL,
  `gtlSource` varchar(50) DEFAULT NULL,
  `gtlSrcID` bigint(20) DEFAULT NULL,
  `gtlTycTax` decimal(24,9) DEFAULT NULL,
  `gtlAmount` decimal(24,9) DEFAULT NULL,
  `gtlCityID` bigint(20) DEFAULT NULL,
  `gtlTaxHold` decimal(24,9) DEFAULT NULL,
  `gtlGoldRate` decimal(28,17) DEFAULT NULL,
  `syncKey` varchar(145) DEFAULT NULL,
  `gtlQApp` varchar(120) DEFAULT NULL,
  `gtlMUID` varchar(150) DEFAULT NULL,
  `gtlBlockID` bigint(20) DEFAULT NULL,
  `gtlSignature` varchar(250) DEFAULT NULL,
  PRIMARY KEY (`gTranLogID`),
  KEY `gtlBlockID` (`gtlBlockID`),
  KEY `gtlDate` (`gtlDate`),
  KEY `syncKey` (`syncKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblGoldTranLog`
--

LOCK TABLES `tblGoldTranLog` WRITE;
/*!40000 ALTER TABLE `tblGoldTranLog` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblGoldTranLog` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblGoldTranMonthSum`
--

DROP TABLE IF EXISTS `tblGoldTranMonthSum`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblGoldTranMonthSum` (
  `gtmsID` bigint(20) NOT NULL AUTO_INCREMENT,
  `gtmsDate` datetime DEFAULT NULL,
  `gtmsGoldType` varchar(50) DEFAULT NULL,
  `gtmsSource` varchar(50) DEFAULT NULL,
  `gtmsTycTax` decimal(24,9) DEFAULT NULL,
  `gtmsAmount` decimal(24,9) DEFAULT NULL,
  `gtmsGoldRate` decimal(28,17) DEFAULT NULL,
  `gtmsMUID` varchar(150) DEFAULT NULL,
  `gtmsBlockNbr` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`gtmsID`),
  KEY `gtmsDate` (`gtmsDate`),
  KEY `gtmsBlockNbr` (`gtmsBlockNbr`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblGoldTranMonthSum`
--

LOCK TABLES `tblGoldTranMonthSum` WRITE;
/*!40000 ALTER TABLE `tblGoldTranMonthSum` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblGoldTranMonthSum` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblGoldTrans`
--

DROP TABLE IF EXISTS `tblGoldTrans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblGoldTrans` (
  `gtrnID` bigint(20) NOT NULL AUTO_INCREMENT,
  `gtrnDate` datetime DEFAULT NULL,
  `gtrnGoldType` varchar(50) DEFAULT NULL,
  `gtrnSource` varchar(50) DEFAULT NULL,
  `gtrnSrcID` bigint(20) DEFAULT NULL,
  `gtrnTycTax` decimal(24,9) DEFAULT NULL,
  `gtrnAmount` decimal(24,9) DEFAULT NULL,
  `gtrnCityID` bigint(20) DEFAULT NULL,
  `gtrnTaxHold` decimal(24,9) DEFAULT NULL,
  `gtrnGoldRate` decimal(28,17) DEFAULT NULL,
  `gtrnSyncKey` varchar(145) DEFAULT NULL,
  `gtrnQApp` varchar(120) DEFAULT NULL,
  `gtrnMUID` varchar(150) DEFAULT NULL,
  `gtrnBlockID` bigint(20) DEFAULT NULL,
  `gtrnSignature` varchar(250) DEFAULT NULL,
  `gtrnBlockConfirmed` datetime DEFAULT NULL,
  PRIMARY KEY (`gtrnID`),
  UNIQUE KEY `gtrnSyncKey` (`gtrnSyncKey`),
  KEY `gtrnBlockID` (`gtrnBlockID`),
  KEY `gtrnDate` (`gtrnDate`),
  KEY `gtrnSrcID` (`gtrnSrcID`),
  KEY `gtrnDateSKey` (`gtrnDate`,`gtrnSyncKey`),
  KEY `gtrnBlockConfirmed` (`gtrnBlockConfirmed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblGoldTrans`
--

LOCK TABLES `tblGoldTrans` WRITE;
/*!40000 ALTER TABLE `tblGoldTrans` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblGoldTrans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblmkyWallets`
--

DROP TABLE IF EXISTS `tblmkyWallets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblmkyWallets` (
  `mwalID` bigint(20) NOT NULL AUTO_INCREMENT,
  `mwalPubKey` varchar(245) DEFAULT NULL,
  `mwalGBranchID` bigint(20) DEFAULT NULL,
  `mwalDate` datetime DEFAULT NULL,
  `mwalGBranchACID` bigint(20) DEFAULT NULL,
  `mwalMUID` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`mwalID`),
  UNIQUE KEY `mwalCombined` (`mwalGBranchID`,`mwalGBranchACID`),
  UNIQUE KEY `mwalMUID` (`mwalMUID`),
  KEY `mwalPubKey` (`mwalPubKey`),
  KEY `mwalDate` (`mwalDate`),
  KEY `mwalGBranchID` (`mwalGBranchID`),
  KEY `mwalGBranchACID` (`mwalGBranchACID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblmkyWallets`
--

LOCK TABLES `tblmkyWallets` WRITE;
/*!40000 ALTER TABLE `tblmkyWallets` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblmkyWallets` ENABLE KEYS */;
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
