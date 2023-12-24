# WARNING
I've managed to test the functionality only on macOS for now. The code for Windows and Linux is also present there, but haven't been able to test it properly yet. I would be very glad if you would create issues to those platforms and send pull requests with proposed fixes. This would help me immensely. 

# Find and attach remote unity debugger.

This extension, unlike Unity VSCode extension is able to attach to a build launched on another device that is connected to your LAN. And just like Unity extension, it's also able to detect builds running on the same device as the code editor.

## Features

It listens to a socket that Unity Editor uses for finding Unity Players for remote debugging/profiling, and then sets up a launch configuration for remote debugging on that player.

## Requirements
- Have Microsoft's Unity extension installed in your editor. (because it's calling internally on the `vstuc` tool that becomes available only upon installing the Unity extension)

## Getting Started

1. Install the extension in VSCode using the vsix package inside the folder `builds`. (Optionally I plan to publish this extension on VSCode marketplace, once I'm sure that it works on other platforms as well.)
2. Open your unity c# project in VSCode.
3. Press `SHIFT+F5` and choose the device/player to attach unity debugger.

## Usage

The command for binding to keyboard shortcuts:
- FindRemoteDebug.findAndAttach (default key shortcut: `SHIFT+F5`)

You can also use the command palette by typing this text:
- Find and Attach Unity Debugger