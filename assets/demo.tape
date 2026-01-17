# Codi Demo GIF
# Run with: vhs assets/demo.tape

Output assets/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 15
Set TypingSpeed 50ms

# Start codi
Type "codi --provider ollama --model llama3.2"
Enter
Sleep 4s

# Show help command
Type "/help"
Enter
Sleep 3s

# Ask about the project
Type "What kind of project is this?"
Enter
Sleep 10s

# Use explain command
Type "/explain src/spinner.ts"
Enter
Sleep 12s

# Exit
Type "/exit"
Enter
Sleep 1s
