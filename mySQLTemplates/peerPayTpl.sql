-- MySQL dump 10.14  Distrib 5.5.52-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: peerPay
-- ------------------------------------------------------
-- Server version	5.5.52-MariaDB

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
-- Table structure for table `accounts`
--

DROP TABLE IF EXISTS `accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `accounts` (
  `ppacID` bigint(20) NOT NULL AUTO_INCREMENT,
  `ppacMUID` varchar(64) COLLATE latin1_bin DEFAULT NULL,
  PRIMARY KEY (`ppacID`),
  UNIQUE KEY `ppacID_UNIQUE` (`ppacID`),
  UNIQUE KEY `ndxPpacMUID` (`ppacMUID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `accounts`
--

LOCK TABLES `accounts` WRITE;
/*!40000 ALTER TABLE `accounts` DISABLE KEYS */;
/*!40000 ALTER TABLE `accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pLedger`
--

DROP TABLE IF EXISTS `pLedger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pLedger` (
  `pledID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pledPacID` bigint(20) DEFAULT NULL,
  `pledTx` varchar(84) COLLATE latin1_bin DEFAULT NULL,
  `pledToAdr` varchar(64) COLLATE latin1_bin DEFAULT NULL,
  `pledFromAdr` varchar(64) COLLATE latin1_bin DEFAULT NULL,
  `pledUnixTime` bigint(20) unsigned DEFAULT NULL,
  `pledDate` datetime DEFAULT NULL,
  `pledBalance` decimal(29,9) DEFAULT NULL,
  `pledTxStatus` int(11) DEFAULT NULL,
  PRIMARY KEY (`pledID`),
  UNIQUE KEY `pledID_UNIQUE` (`pledID`),
  KEY `ndxPledPacID` (`pledPacID`),
  KEY `ndxPledTx` (`pledTx`),
  KEY `ndxPledToAdr` (`pledToAdr`),
  KEY `ndxPledFromAdr` (`pledFromAdr`),
  KEY `ndxPledUnixTime` (`pledUnixTime`),
  KEY `ndxPledTxStatus` (`pledTxStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pLedger`
--

LOCK TABLES `pLedger` WRITE;
/*!40000 ALTER TABLE `pLedger` DISABLE KEYS */;
/*!40000 ALTER TABLE `pLedger` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payCells`
--

DROP TABLE IF EXISTS `payCells`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payCells` (
  `paycID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `paycAddress` varchar(84) COLLATE latin1_bin DEFAULT NULL,
  `paycLastStatus` varchar(20) COLLATE latin1_bin DEFAULT NULL,
  `paycLastMsg` datetime DEFAULT NULL,
  `paycMUID` varchar(64) COLLATE latin1_bin DEFAULT NULL,
  PRIMARY KEY (`paycID`),
  KEY `ndxPaycAddress` (`paycAddress`),
  KEY `ndxPaycStatus` (`paycLastStatus`),
  KEY `ndxPaycLastMsg` (`paycLastMsg`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payCells`
--

LOCK TABLES `payCells` WRITE;
/*!40000 ALTER TABLE `payCells` DISABLE KEYS */;
/*!40000 ALTER TABLE `payCells` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `qryLedgerResults`
--

DROP TABLE IF EXISTS `qryLedgerResults`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `qryLedgerResults` (
  `qledID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `qledTx` varchar(84) COLLATE latin1_bin DEFAULT NULL,
  `qledConfirmations` int(10) unsigned DEFAULT NULL,
  `qledToAdr` varchar(64) COLLATE latin1_bin DEFAULT NULL,
  `qledFromAdr` varchar(64) COLLATE latin1_bin DEFAULT NULL,
  `qledUnixTime` bigint(20) DEFAULT NULL,
  `qledDate` datetime DEFAULT NULL,
  `qledTxStatus` int(11) DEFAULT NULL,
  `qledBalance` decimal(29,9) DEFAULT NULL,
  PRIMARY KEY (`qledID`),
  UNIQUE KEY `qledID_UNIQUE` (`qledID`),
  KEY `ndxQledUnixTime` (`qledUnixTime`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `qryLedgerResults`
--

LOCK TABLES `qryLedgerResults` WRITE;
/*!40000 ALTER TABLE `qryLedgerResults` DISABLE KEYS */;
/*!40000 ALTER TABLE `qryLedgerResults` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2023-01-22 12:54:55
