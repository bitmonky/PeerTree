-- MySQL dump 10.14  Distrib 5.5.52-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: ftreeFileMgr
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
-- Table structure for table `tblRepo`
--

DROP TABLE IF EXISTS `tblRepo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblRepo` (
  `repoID` bigint(20) NOT NULL AUTO_INCREMENT,
  `repoName` varchar(245) DEFAULT NULL,
  `repoPubKey` varchar(245) DEFAULT NULL,
  `repoOwner` varchar(84) DEFAULT NULL,
  `repoLastUpdate` datetime DEFAULT NULL,
  `repoSignature` varchar(245) DEFAULT NULL,
  `repoHash` varchar(84) DEFAULT NULL,
  `repoCopies` int(11) DEFAULT NULL,
  `repoType` varchar(15) DEFAULT NULL,
  PRIMARY KEY (`repoID`),
  KEY `ndxRepoName` (`repoName`),
  KEY `ndxRepoLastUpdate` (`repoLastUpdate`),
  KEY `ndxRepoOwner` (`repoOwner`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblRepo`
--

LOCK TABLES `tblRepo` WRITE;
/*!40000 ALTER TABLE `tblRepo` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblRepo` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblShardFileMgr`
--

DROP TABLE IF EXISTS `tblShardFileMgr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblShardFileMgr` (
  `smgrID` bigint(20) NOT NULL AUTO_INCREMENT,
  `smgrRepoID` bigint(20) DEFAULT NULL,
  `smgrFileName` varchar(245) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `smgrCheckSum` varchar(84) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `smgrDate` datetime DEFAULT NULL,
  `smgrExpires` datetime DEFAULT NULL,
  `smgrEncrypted` int(11) DEFAULT NULL,
  `smgrFileType` varchar(45) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `smgrFileSize` bigint(20) unsigned DEFAULT NULL,
  `smgrFVersionNbr` bigint(20) DEFAULT NULL,
  `smgrSignature` varchar(245) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `smgrShardList` varchar(84) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  PRIMARY KEY (`smgrID`),
  KEY `ndxSmgrFVersionNbr` (`smgrFVersionNbr`),
  KEY `ndxSmgrFileName` (`smgrFileName`(191)),
  KEY `ndxSmgrDate` (`smgrDate`)
) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblShardFileMgr`
--

LOCK TABLES `tblShardFileMgr` WRITE;
/*!40000 ALTER TABLE `tblShardFileMgr` DISABLE KEYS */;
INSERT INTO `tblShardFileMgr` VALUES (108,1,'file1','dsafdsaf','0000-00-00 00:00:00','2024-02-02 19:57:12',0,'junk',78,1,'sadfds','asdfsdf');
/*!40000 ALTER TABLE `tblShardFileMgr` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblShardFiles`
--

DROP TABLE IF EXISTS `tblShardFiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblShardFiles` (
  `sfilID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sfilFileMgrID` bigint(20) DEFAULT NULL,
  `sfilCheckSum` varchar(84) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `sfilShardHash` varchar(84) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `sfilNCopies` int(11) DEFAULT NULL,
  `sfilDate` datetime DEFAULT NULL,
  `sfilExpires` datetime DEFAULT NULL,
  `sfilEncrypted` int(11) DEFAULT NULL,
  `sfilShardNbr` int(11) DEFAULT NULL,
  PRIMARY KEY (`sfilID`),
  UNIQUE KEY `sfilID_UNIQUE` (`sfilID`),
  KEY `ndxSfilShardHash` (`sfilShardHash`),
  KEY `ndxSfilCheckSum` (`sfilCheckSum`),
  KEY `ndxSfilDate` (`sfilDate`),
  KEY `ndxSfilExpires` (`sfilExpires`),
  KEY `ndxSfilFileMgrID` (`sfilFileMgrID`),
  KEY `ndxSfilShardNbr` (`sfilShardNbr`)
) ENGINE=InnoDB AUTO_INCREMENT=385 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblShardFiles`
--

LOCK TABLES `tblShardFiles` WRITE;
/*!40000 ALTER TABLE `tblShardFiles` DISABLE KEYS */;
INSERT INTO `tblShardFiles` VALUES (384,108,'safsdfds','sdafdsaf',1,'2024-02-02 20:08:47','2024-02-02 20:08:47',0,1);
/*!40000 ALTER TABLE `tblShardFiles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tblShardHosts`
--

DROP TABLE IF EXISTS `tblShardHosts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblShardHosts` (
  `shosID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `shosSfilID` bigint(20) DEFAULT NULL,
  `shosAddress` varchar(64) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  `shosIP` varchar(45) COLLATE utf8mb4_czech_ci DEFAULT NULL,
  PRIMARY KEY (`shosID`),
  KEY `ndxShosSfilID` (`shosSfilID`),
  KEY `ndxShosAddress` (`shosAddress`)
) ENGINE=InnoDB AUTO_INCREMENT=805 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tblShardHosts`
--

LOCK TABLES `tblShardHosts` WRITE;
/*!40000 ALTER TABLE `tblShardHosts` DISABLE KEYS */;
/*!40000 ALTER TABLE `tblShardHosts` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2024-02-23 11:03:06
