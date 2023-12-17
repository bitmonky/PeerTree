-- MySQL dump 10.14  Distrib 5.5.52-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: peerBrain
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
-- Table structure for table `peerMemCells`
--

DROP TABLE IF EXISTS `peerMemCells`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `peerMemCells` (
  `pcelID` bigint(20) NOT NULL AUTO_INCREMENT,
  `pcelAddress` varchar(64) DEFAULT NULL,
  `pcelLastStatus` varchar(20) DEFAULT NULL,
  `pcelLastMsg` datetime DEFAULT NULL,
  `pcelPubKey` varchar(145) DEFAULT NULL,
  `pcelOwnMUID` varchar(84) DEFAULT NULL,
  PRIMARY KEY (`pcelID`),
  UNIQUE KEY `pcelID_UNIQUE` (`pcelID`),
  KEY `ndxPcelAddress` (`pcelAddress`),
  KEY `ndxPcelLastStatus` (`pcelLastStatus`),
  KEY `ndxPcelLastMsg` (`pcelLastMsg`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `peerMemCells`
--

LOCK TABLES `peerMemCells` WRITE;
/*!40000 ALTER TABLE `peerMemCells` DISABLE KEYS */;
/*!40000 ALTER TABLE `peerMemCells` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `peerMemLocations`
--

DROP TABLE IF EXISTS `peerMemLocations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `peerMemLocations` (
  `plocID` bigint(20) NOT NULL AUTO_INCREMENT,
  `plocCityID` bigint(20) DEFAULT NULL,
  `plocStateID` int(11) DEFAULT NULL,
  `plocCountryID` int(11) DEFAULT NULL,
  `plocWRegionID` int(11) DEFAULT NULL,
  PRIMARY KEY (`plocID`),
  KEY `ndxPlocCityID` (`plocCityID`),
  KEY `ndxPlocStateID` (`plocStateID`),
  KEY `ndxPlocCountryID` (`plocCountryID`),
  KEY `ndxPlocWRegionID` (`plocWRegionID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `peerMemLocations`
--

LOCK TABLES `peerMemLocations` WRITE;
/*!40000 ALTER TABLE `peerMemLocations` DISABLE KEYS */;
/*!40000 ALTER TABLE `peerMemLocations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `peerMemOwners`
--

DROP TABLE IF EXISTS `peerMemOwners`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `peerMemOwners` (
  `permID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `permMUID` varchar(84) DEFAULT NULL,
  PRIMARY KEY (`permID`),
  UNIQUE KEY `ndxPermMUID` (`permMUID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `peerMemOwners`
--

LOCK TABLES `peerMemOwners` WRITE;
/*!40000 ALTER TABLE `peerMemOwners` DISABLE KEYS */;
/*!40000 ALTER TABLE `peerMemOwners` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `peerMemoryCell`
--

DROP TABLE IF EXISTS `peerMemoryCell`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `peerMemoryCell` (
  `pmcID` bigint(20) NOT NULL AUTO_INCREMENT,
  `pmcMownerID` varchar(84) DEFAULT NULL,
  `pmcMemObjID` varchar(84) DEFAULT NULL,
  `pmcMemWord` varchar(45) DEFAULT NULL,
  `pmcWordSequence` int(11) DEFAULT NULL,
  `pmcMemObjNWords` int(11) DEFAULT NULL,
  `pmcMemObjType` varchar(45) DEFAULT NULL,
  `pmcMemTWeight` int(11) DEFAULT NULL,
  `pmcMemTime` datetime DEFAULT NULL,
  `pmcCityID` bigint(20) DEFAULT NULL,
  `pmcWordCount` int(11) DEFAULT NULL,
  `pmcWordWeight` int(11) DEFAULT NULL,
  PRIMARY KEY (`pmcID`),
  KEY `ndxPmcOwnerID` (`pmcMownerID`),
  KEY `ndxPmcMemObjID` (`pmcMemObjID`),
  KEY `ndxPmcWord` (`pmcMemWord`),
  KEY `ndxPmcWordSeqID` (`pmcWordSequence`),
  KEY `ndxPmcMemObjType` (`pmcMemObjType`),
  KEY `ndxPmcMemTime` (`pmcMemTime`),
  KEY `ndxPmcCityID` (`pmcCityID`),
  KEY `ndxPmcWordCount` (`pmcWordCount`),
  KEY `ndxPmcWordWeight` (`pmcWordWeight`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `peerMemoryCell`
--

LOCK TABLES `peerMemoryCell` WRITE;
/*!40000 ALTER TABLE `peerMemoryCell` DISABLE KEYS */;
/*!40000 ALTER TABLE `peerMemoryCell` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `peerSearchResults`
--

DROP TABLE IF EXISTS `peerSearchResults`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `peerSearchResults` (
  `psrchID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `psrchHash` varchar(64) DEFAULT NULL,
  `psrchScore` decimal(14,9) DEFAULT NULL,
  `psrchMemoryID` varchar(64) DEFAULT NULL,
  `psrchDate` datetime DEFAULT NULL,
  `psrchNodeIP` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`psrchID`),
  KEY `ndxPsrcHash` (`psrchHash`),
  KEY `ndxPsrcScore` (`psrchScore`),
  KEY `ndxPsrcDate` (`psrchDate`),
  KEY `ndxPsrcNodeIP` (`psrchNodeIP`),
  KEY `ndxPsrcMemoryID` (`psrchMemoryID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `peerSearchResults`
--

LOCK TABLES `peerSearchResults` WRITE;
/*!40000 ALTER TABLE `peerSearchResults` DISABLE KEYS */;
/*!40000 ALTER TABLE `peerSearchResults` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2023-12-17 17:07:18
