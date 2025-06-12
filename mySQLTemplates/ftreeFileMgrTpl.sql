-- MariaDB dump 10.19  Distrib 10.11.6-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: ftreeFileMgr
-- ------------------------------------------------------
-- Server version	10.11.6-MariaDB-0+deb12u1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
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
  `repoID_master` varchar(48) DEFAULT NULL,
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
  KEY `ndxRepoOwner` (`repoOwner`),
  KEY `ndxRepoType` (`repoType`),
  KEY `idx_repoID_master` (`repoID_master`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tblRepoFolder`
--

DROP TABLE IF EXISTS `tblRepoFolder`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblRepoFolder` (
  `rfoldID` bigint(20) NOT NULL AUTO_INCREMENT,
  `repoID_master` varchar(48) DEFAULT NULL,
  `rfoldID_master` bigint(20) DEFAULT NULL,
  `rfoldRepoID` bigint(20) DEFAULT NULL,
  `rfoldName` varchar(1025) DEFAULT NULL,
  `rfoldParentID` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`rfoldID`),
  KEY `ndxRfoldRepoID` (`rfoldRepoID`),
  KEY `ndxRfoldname` (`rfoldName`(767)),
  KEY `ndxRfoldParentID` (`rfoldParentID`),
  KEY `idx_repoID_master` (`repoID_master`),
  KEY `idx_rfoldID_master` (`rfoldID_master`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tblShardFileMgr`
--

DROP TABLE IF EXISTS `tblShardFileMgr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblShardFileMgr` (
  `smgrID` bigint(20) NOT NULL AUTO_INCREMENT,
  `repoID_master` varchar(48) DEFAULT NULL,
  `smgrID_master` bigint(20) DEFAULT NULL,
  `smgrRepoID` bigint(20) DEFAULT NULL,
  `smgrFileName` varchar(245) DEFAULT NULL,
  `smgrCheckSum` varchar(84) DEFAULT NULL,
  `smgrDate` datetime DEFAULT NULL,
  `smgrExpires` datetime DEFAULT NULL,
  `smgrEncrypted` int(11) DEFAULT NULL,
  `smgrFileType` varchar(45) DEFAULT NULL,
  `smgrFileSize` bigint(20) unsigned DEFAULT NULL,
  `smgrFVersionNbr` bigint(20) DEFAULT NULL,
  `smgrSignature` varchar(245) DEFAULT NULL,
  `smgrShardList` varchar(84) DEFAULT NULL,
  `smgrFileFolderID` bigint(20) DEFAULT 0,
  `smgrFilePath` varchar(1045) DEFAULT '',
  PRIMARY KEY (`smgrID`),
  KEY `ndxSmgrFVersionNbr` (`smgrFVersionNbr`),
  KEY `ndxSmgrFileName` (`smgrFileName`(191)),
  KEY `ndxSmgrDate` (`smgrDate`),
  KEY `ndxSmgrFileFolder` (`smgrFileFolderID`),
  KEY `idx_repoID_master` (`repoID_master`),
  KEY `idx_smgrID_master` (`smgrID_master`)
) ENGINE=InnoDB AUTO_INCREMENT=878 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tblShardFiles`
--

DROP TABLE IF EXISTS `tblShardFiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblShardFiles` (
  `sfilID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `repoID_master` varchar(48) DEFAULT NULL,
  `sfilID_master` bigint(20) DEFAULT NULL,
  `sfilFileMgrID` bigint(20) DEFAULT NULL,
  `sfilCheckSum` varchar(84) DEFAULT NULL,
  `sfilShardHash` varchar(84) DEFAULT NULL,
  `sfilNCopies` int(11) DEFAULT NULL,
  `sfilDate` datetime DEFAULT NULL,
  `sfilExpires` datetime DEFAULT NULL,
  `sfilEncrypted` int(11) DEFAULT NULL,
  `sfilShardID` varchar(84) DEFAULT NULL,
  PRIMARY KEY (`sfilID`),
  UNIQUE KEY `sfilID_UNIQUE` (`sfilID`),
  KEY `ndxSfilShardHash` (`sfilShardHash`),
  KEY `ndxSfilCheckSum` (`sfilCheckSum`),
  KEY `ndxSfilDate` (`sfilDate`),
  KEY `ndxSfilExpires` (`sfilExpires`),
  KEY `ndxSfilFileMgrID` (`sfilFileMgrID`),
  KEY `ndxSfilShardNbr` (`sfilShardNbr`),
  KEY `idx_repoID_master` (`repoID_master`),
  KEY `idx_sfilID_master` (`sfilID_master`)
) ENGINE=InnoDB AUTO_INCREMENT=342158 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tblShardHosts`
--

DROP TABLE IF EXISTS `tblShardHosts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tblShardHosts` (
  `shosID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `shosSfilID` bigint(20) DEFAULT NULL,
  `shosAddress` varchar(64) DEFAULT NULL,
  `shosIP` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`shosID`),
  KEY `ndxShosSfilID` (`shosSfilID`),
  KEY `ndxShosAddress` (`shosAddress`)
) ENGINE=InnoDB AUTO_INCREMENT=805 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-05-03 13:29:19
