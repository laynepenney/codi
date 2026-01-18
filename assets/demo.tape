# Codi Demo GIF
# Run with: cd /path/to/codi && vhs assets/demo.tape

Output assets/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 60ms
Set CursorBlink false

# Start codi (assumes already in codi directory)
Type "codi"
Enter
Sleep 4s

# Show help
Type "/help"
Enter
Sleep 6s

# Show context/status
Type "/status"
Enter
Sleep 5s

# Ask about the codebase
Type "What providers does this project support?"
Enter
Sleep 15s

# Search for commands with ? shortcut
Type "?git"
Enter
Sleep 5s

# Exit
Type "/exit"
Enter
Sleep 2s
