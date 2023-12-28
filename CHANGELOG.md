# Change Log

All notable changes to the "findAndRemoteDebug" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0]

- Initial release

## [1.0.1]

Major hotfix for macOS and hopefully for other platforms.

### Fixes

- Introduce an alternate way of identifying IP address and port for a game build broadcasting hostname instead of IP and port inside the Id parameter of the broadcasting message
- Fix not being able to attach to Unity Editor when a game build is running at the same time. 

## [1.0.2]

Hotfix for Windows OS not being able to extract the debug port in local processes.

## [1.0.3]

Fix not being able to attach debugger onto Unity Editor when launching from Windows OS.