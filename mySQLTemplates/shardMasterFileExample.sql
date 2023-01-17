CREATE TABLE `yourSchema`.`tblShardFiles` (
  `sfilID` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sfilCheckSum` VARCHAR(84) NULL,
  `sfilShardHash` VARCHAR(84) NULL,
  `sfilNCopies` INT NULL,
  `sfileDate` DATETIME NULL,
  `sfileExpires` DATETIME NULL,
  `sfilEncrypted` INT NULL,
  PRIMARY KEY (`sfilID`),
  UNIQUE INDEX `sfilID_UNIQUE` (`sfilID` ASC),
  INDEX `ndxSfilShardHash` (`sfilShardHash` ASC),
  INDEX `ndxSfilCheckSum` (`sfilCheckSum` ASC),
  INDEX `ndxSfilDate` (`sfileDate` ASC),
  INDEX `ndxSfilExpires` (`sfileExpires` ASC));
