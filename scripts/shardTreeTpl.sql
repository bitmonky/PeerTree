-- MySQL dump 10.14  Distrib 5.5.52-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: shardTree
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
-- Table structure for table `shardCells`
--

DROP TABLE IF EXISTS `shardCells`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `shardCells` (
  `scelID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `scelAddress` varchar(64) DEFAULT NULL,
  `scelLastStatus` varchar(20) DEFAULT NULL,
  `scelLastMsg` datetime DEFAULT NULL,
  `scelPubKey` varchar(145) DEFAULT NULL,
  `scelOwnMUID` varchar(84) DEFAULT NULL,
  PRIMARY KEY (`scelID`),
  UNIQUE KEY `scellID_UNIQUE` (`scelID`),
  UNIQUE KEY `scellAddress_UNIQUE` (`scelAddress`),
  KEY `ndxPcelLastStatus` (`scelLastStatus`),
  KEY `ndxPcelLastMsg` (`scelLastMsg`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shardCells`
--

LOCK TABLES `shardCells` WRITE;
/*!40000 ALTER TABLE `shardCells` DISABLE KEYS */;
/*!40000 ALTER TABLE `shardCells` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shardOwners`
--

DROP TABLE IF EXISTS `shardOwners`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `shardOwners` (
  `sownID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sownMUID` varchar(84) NOT NULL,
  PRIMARY KEY (`sownID`),
  UNIQUE KEY `sownID_UNIQUE` (`sownID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shardOwners`
--

LOCK TABLES `shardOwners` WRITE;
/*!40000 ALTER TABLE `shardOwners` DISABLE KEYS */;
/*!40000 ALTER TABLE `shardOwners` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shards`
--

DROP TABLE IF EXISTS `shards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `shards` (
  `shardID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `shardOwnerID` bigint(20) DEFAULT NULL,
  `shardHash` varchar(84) DEFAULT NULL,
  `shardDate` datetime DEFAULT NULL,
  `shardExpire` datetime DEFAULT NULL,
  `shardData` blob,
  PRIMARY KEY (`shardID`),
  KEY `ndxShardDate` (`shardDate`),
  KEY `ndxShardHash` (`shardHash`),
  KEY `ndxShardOwnerID` (`shardOwnerID`),
  KEY `jndxShardExpire` (`shardExpire`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shards`
--

LOCK TABLES `shards` WRITE;
/*!40000 ALTER TABLE `shards` DISABLE KEYS */;
/*!40000 ALTER TABLE `shards` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2023-01-17 10:59:36
