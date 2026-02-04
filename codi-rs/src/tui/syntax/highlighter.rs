use std::collections::HashMap;

use ratatui::{
    style::{Color, Style},
    text::Span,
};
use streaming_iterator::StreamingIterator;
use tree_sitter::{Parser, Query, QueryCursor};

/// Supported languages for syntax highlighting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SupportedLanguage {
    Rust,
    TypeScript,
    Python,
    Go,
    JavaScript,
    Json,
    Bash,
    Markdown,
}

impl SupportedLanguage {
    /// Detect language from file extension or language identifier.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "rs" => Some(SupportedLanguage::Rust),
            "ts" | "tsx" => Some(SupportedLanguage::TypeScript),
            "py" | "pyw" => Some(SupportedLanguage::Python),
            "go" => Some(SupportedLanguage::Go),
            "js" | "jsx" | "mjs" | "cjs" => Some(SupportedLanguage::JavaScript),
            "json" => Some(SupportedLanguage::Json),
            "sh" | "bash" | "zsh" | "fish" => Some(SupportedLanguage::Bash),
            "md" | "markdown" => Some(SupportedLanguage::Markdown),
            _ => None,
        }
    }

    /// Get the tree-sitter language parser.
    pub fn tree_sitter_language(&self) -> tree_sitter::Language {
        match self {
            SupportedLanguage::Rust => tree_sitter_rust::LANGUAGE.into(),
            SupportedLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            SupportedLanguage::Python => tree_sitter_python::LANGUAGE.into(),
            SupportedLanguage::Go => tree_sitter_go::LANGUAGE.into(),
            SupportedLanguage::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            SupportedLanguage::Json => tree_sitter_json::LANGUAGE.into(),
            SupportedLanguage::Bash => tree_sitter_bash::LANGUAGE.into(),
            SupportedLanguage::Markdown => tree_sitter_rust::LANGUAGE.into(), // FIXME: tree-sitter-markdown 0.7 uses incompatible tree-sitter 0.19
        }
    }

    /// Get highlight query for this language.
    pub fn highlight_query(&self) -> &'static str {
        match self {
            SupportedLanguage::Rust => RUST_HIGHLIGHT_QUERY,
            SupportedLanguage::TypeScript => TYPESCRIPT_HIGHLIGHT_QUERY,
            SupportedLanguage::Python => PYTHON_HIGHLIGHT_QUERY,
            SupportedLanguage::Go => GO_HIGHLIGHT_QUERY,
            SupportedLanguage::JavaScript => JAVASCRIPT_HIGHLIGHT_QUERY,
            SupportedLanguage::Json => JSON_HIGHLIGHT_QUERY,
            SupportedLanguage::Bash => BASH_HIGHLIGHT_QUERY,
            SupportedLanguage::Markdown => MARKDOWN_HIGHLIGHT_QUERY,
        }
    }
}

/// Dark theme color palette (default).
#[derive(Debug, Clone)]
pub struct Theme {
    pub foreground: Color,
    pub background: Color,
    pub comment: Color,
    pub keyword: Color,
    pub string: Color,
    pub number: Color,
    pub function: Color,
    pub type_name: Color,
    pub variable: Color,
    pub operator: Color,
    pub constant: Color,
    pub attribute: Color,
}

impl Default for Theme {
    fn default() -> Self {
        Self::dark()
    }
}

impl Theme {
    /// Dark theme (default).
    pub fn dark() -> Self {
        Self {
            foreground: Color::White,
            background: Color::Black,
            comment: Color::DarkGray,
            keyword: Color::Magenta,
            string: Color::Green,
            number: Color::Yellow,
            function: Color::Blue,
            type_name: Color::Cyan,
            variable: Color::White,
            operator: Color::Red,
            constant: Color::Yellow,
            attribute: Color::LightCyan,
        }
    }

    /// Apply style based on highlight type.
    pub fn style_for(&self, highlight_type: HighlightType) -> Style {
        let color = match highlight_type {
            HighlightType::Comment => self.comment,
            HighlightType::Keyword => self.keyword,
            HighlightType::String => self.string,
            HighlightType::Number => self.number,
            HighlightType::Function => self.function,
            HighlightType::Type => self.type_name,
            HighlightType::Variable => self.variable,
            HighlightType::Operator => self.operator,
            HighlightType::Constant => self.constant,
            HighlightType::Attribute => self.attribute,
            HighlightType::None => self.foreground,
        };
        Style::default().fg(color)
    }
}

/// Types of syntax highlights.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HighlightType {
    None,
    Comment,
    Keyword,
    String,
    Number,
    Function,
    Type,
    Variable,
    Operator,
    Constant,
    Attribute,
}

/// Syntax highlighter using tree-sitter.
pub struct SyntaxHighlighter {
    theme: Theme,
    parsers: HashMap<SupportedLanguage, Parser>,
    queries: HashMap<SupportedLanguage, Query>,
}

impl SyntaxHighlighter {
    /// Create a new syntax highlighter with default dark theme.
    pub fn new() -> Self {
        Self {
            theme: Theme::default(),
            parsers: HashMap::new(),
            queries: HashMap::new(),
        }
    }

    /// Create with custom theme.
    pub fn with_theme(theme: Theme) -> Self {
        Self {
            theme,
            parsers: HashMap::new(),
            queries: HashMap::new(),
        }
    }

    /// Get or create parser for language.
    fn get_parser(&mut self, lang: SupportedLanguage) -> Option<&mut Parser> {
        if !self.parsers.contains_key(&lang) {
            let mut parser = Parser::new();
            let ts_lang = lang.tree_sitter_language();
            parser.set_language(&ts_lang).ok()?;
            self.parsers.insert(lang, parser);
        }
        self.parsers.get_mut(&lang)
    }

    /// Get or create query for language.
    fn get_query(&mut self, lang: SupportedLanguage) -> Option<&Query> {
        if !self.queries.contains_key(&lang) {
            let ts_lang = lang.tree_sitter_language();
            let query = Query::new(&ts_lang, lang.highlight_query()).ok()?;
            self.queries.insert(lang, query);
        }
        self.queries.get(&lang)
    }

    /// Highlight code and return styled spans.
    pub fn highlight(&mut self, code: &str, lang: SupportedLanguage) -> Vec<Vec<Span<'static>>> {
        let parser = match self.get_parser(lang) {
            Some(p) => p,
            None => return Self::plain_text_lines(code),
        };

        let tree = match parser.parse(code, None) {
            Some(t) => t,
            None => return Self::plain_text_lines(code),
        };

        let query = match self.get_query(lang) {
            Some(q) => q,
            None => return Self::plain_text_lines(code),
        };

        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(query, tree.root_node(), code.as_bytes());

        let mut highlights: HashMap<usize, HighlightType> = HashMap::new();

        while let Some(m) = matches.next() {
            for capture in m.captures {
                let capture_name = query.capture_names()[capture.index as usize];
                let highlight_type = Self::capture_to_highlight(capture_name);

                let node = capture.node;
                for i in node.start_byte()..node.end_byte() {
                    if Self::is_more_specific(
                        highlight_type,
                        *highlights.get(&i).unwrap_or(&HighlightType::None),
                    ) {
                        highlights.insert(i, highlight_type);
                    }
                }
            }
        }

        let mut lines: Vec<Vec<Span>> = Vec::new();
        let mut current_line: Vec<Span> = Vec::new();
        let mut line_start = 0;

        for (i, c) in code.char_indices() {
            if c == '\n' {
                if i > line_start {
                    current_line.push(self.span_for_range(
                        &code[line_start..i],
                        &highlights,
                        line_start,
                    ));
                }
                lines.push(current_line);
                current_line = Vec::new();
                line_start = i + 1;
            }
        }

        if line_start < code.len() {
            current_line.push(self.span_for_range(&code[line_start..], &highlights, line_start));
        }
        if !current_line.is_empty() {
            lines.push(current_line);
        }

        lines
    }

    /// Convert plain text to unstyled lines.
    fn plain_text_lines(code: &str) -> Vec<Vec<Span<'static>>> {
        code.lines()
            .map(|line| vec![Span::raw(line.to_string())])
            .collect()
    }

    /// Create a span for a range of text with highlighting.
    fn span_for_range(
        &self,
        text: &str,
        highlights: &HashMap<usize, HighlightType>,
        start_offset: usize,
    ) -> Span<'static> {
        let first_highlight = highlights
            .get(&start_offset)
            .copied()
            .unwrap_or(HighlightType::None);
        let all_same = (start_offset..start_offset + text.len())
            .all(|i| highlights.get(&i).copied().unwrap_or(HighlightType::None) == first_highlight);

        if all_same {
            Span::styled(text.to_string(), self.theme.style_for(first_highlight))
        } else {
            Span::raw(text.to_string())
        }
    }

    /// Convert capture name to highlight type.
    fn capture_to_highlight(name: &str) -> HighlightType {
        match name {
            "comment" => HighlightType::Comment,
            "keyword" | "keyword.control" | "keyword.function" => HighlightType::Keyword,
            "string" | "string.quoted" | "string.literal" => HighlightType::String,
            "number" | "integer" | "float" => HighlightType::Number,
            "function" | "function.call" | "function.method" => HighlightType::Function,
            "type" | "type.builtin" | "type.definition" => HighlightType::Type,
            "variable" | "variable.parameter" | "variable.other" => HighlightType::Variable,
            "operator" | "operator.logical" | "operator.arithmetic" => HighlightType::Operator,
            "constant" | "constant.builtin" | "constant.language" => HighlightType::Constant,
            "attribute" | "decorator" | "annotation" => HighlightType::Attribute,
            _ => HighlightType::None,
        }
    }

    /// Check if highlight a is more specific than b.
    fn is_more_specific(a: HighlightType, b: HighlightType) -> bool {
        let priority = |t: HighlightType| match t {
            HighlightType::None => 0,
            HighlightType::Variable => 1,
            HighlightType::Constant => 2,
            HighlightType::Attribute => 3,
            HighlightType::Operator => 4,
            HighlightType::Number => 5,
            HighlightType::String => 6,
            HighlightType::Type => 7,
            HighlightType::Function => 8,
            HighlightType::Keyword => 9,
            HighlightType::Comment => 10,
        };
        priority(a) > priority(b)
    }

    /// Highlight code block and return as single vector of spans.
    pub fn highlight_block(&mut self, code: &str, lang: SupportedLanguage) -> Vec<Span<'static>> {
        let lines = self.highlight(code, lang);
        let mut result = Vec::new();

        for (i, line) in lines.into_iter().enumerate() {
            if i > 0 {
                result.push(Span::raw("\n".to_string()));
            }
            result.extend(line);
        }

        result
    }
}

impl Default for SyntaxHighlighter {
    fn default() -> Self {
        Self::new()
    }
}

// Tree-sitter highlight queries for each language
const RUST_HIGHLIGHT_QUERY: &str = r#"
; Keywords
"fn" "struct" "enum" "impl" "trait" "type" "let" "mut" "const" "static" "pub" "use" "mod" "crate" "self" "Self" "super" "where" "if" "else" "match" "for" "while" "loop" "return" "break" "continue" "async" "await" "move" "ref" "Box" "Vec" "Option" "Result" @keyword

; Types
(type_identifier) @type
(primitive_type) @type.builtin

; Functions
(function_item name: (identifier) @function)
(call_expression function: (identifier) @function.call)
(call_expression function: (field_expression field: (field_identifier) @function.method))

; Variables
(identifier) @variable
(parameter (identifier) @variable.parameter)

; Strings
(string_literal) @string
(raw_string_literal) @string
(char_literal) @string

; Numbers
(integer_literal) @number
(float_literal) @number
(boolean_literal) @constant

; Comments
(line_comment) @comment
(block_comment) @comment
(doc_comment) @comment

; Attributes
(attribute_item) @attribute
"#;

const TYPESCRIPT_HIGHLIGHT_QUERY: &str = r#"
; Keywords
"const" "let" "var" "function" "class" "interface" "type" "enum" "namespace" "module" "import" "export" "from" "return" "if" "else" "for" "while" "switch" "case" "break" "continue" "try" "catch" "throw" "new" "this" "super" "extends" "implements" "public" "private" "protected" "static" "readonly" "abstract" "async" "await" "yield" @keyword

; Types
(type_identifier) @type
(predefined_type) @type.builtin

; Functions
(function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function.method)
(call_expression function: (identifier) @function.call)

; Variables
(identifier) @variable
(formal_parameters (identifier) @variable.parameter)

; Strings
(string) @string
(template_string) @string

; Numbers
(number) @number
(true) (false) @constant

; Comments
(comment) @comment

; Decorators
(decorator) @attribute
"#;

const PYTHON_HIGHLIGHT_QUERY: &str = r#"
; Keywords
"def" "class" "if" "elif" "else" "for" "while" "try" "except" "finally" "with" "as" "return" "yield" "raise" "break" "continue" "pass" "lambda" "global" "nonlocal" "assert" "del" "import" "from" "async" "await" @keyword

; Functions
(function_definition name: (identifier) @function)
(call function: (identifier) @function.call)
(call function: (attribute attribute: (identifier) @function.method))

; Variables
(identifier) @variable
(parameters (identifier) @variable.parameter)

; Strings
(string) @string
(escape_sequence) @string

; Numbers
(integer) @number
(float) @number
(true) (false) (none) @constant

; Comments
(comment) @comment

; Decorators
(decorator) @attribute
"#;

const GO_HIGHLIGHT_QUERY: &str = r#"
; Keywords
"func" "type" "struct" "interface" "map" "chan" "const" "var" "import" "package" "return" "if" "else" "for" "range" "switch" "case" "default" "break" "continue" "goto" "defer" "go" "select" "fallthrough" @keyword

; Types
(type_identifier) @type
(builtin_type) @type.builtin

; Functions
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @function.method)
(call_expression function: (identifier) @function.call)

; Variables
(identifier) @variable
(parameter_declaration (identifier) @variable.parameter)

; Strings
(raw_string_literal) @string
(interpreted_string_literal) @string
(rune_literal) @string

; Numbers
(int_literal) @number
(float_literal) @number
(true) (false) @constant

; Comments
(comment) @comment
"#;

const JAVASCRIPT_HIGHLIGHT_QUERY: &str = r#"
; Keywords
"const" "let" "var" "function" "class" "import" "export" "from" "return" "if" "else" "for" "while" "switch" "case" "break" "continue" "try" "catch" "throw" "new" "this" "super" "extends" "async" "await" "yield" @keyword

; Functions
(function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function.method)
(call_expression function: (identifier) @function.call)

; Variables
(identifier) @variable
(formal_parameters (identifier) @variable.parameter)

; Strings
(string) @string
(template_string) @string

; Numbers
(number) @number
(true) (false) @constant

; Comments
(comment) @comment
"#;

const JSON_HIGHLIGHT_QUERY: &str = r#"
; Keys
(pair key: (string) @attribute)

; Strings
(string) @string

; Numbers
(number) @number

; Constants
(true) (false) @constant
(null) @constant
"#;

const BASH_HIGHLIGHT_QUERY: &str = r#"
; Keywords
"if" "then" "else" "elif" "fi" "for" "while" "do" "done" "case" "esac" "in" "function" "return" "break" "continue" "shift" "local" "export" "readonly" "unset" @keyword

; Commands
(command name: (word) @function)
(function_definition name: (word) @function)

; Strings
(string) @string
(raw_string) @string
(heredoc_body) @string

; Variables
(variable_name) @variable
(expansion (variable_name) @variable)

; Comments
(comment) @comment
"#;

const MARKDOWN_HIGHLIGHT_QUERY: &str = r#"
; Headers
(atx_heading) @keyword
(setext_heading) @keyword

; Code blocks
(fenced_code_block) @string
(indented_code_block) @string

; Emphasis
(emphasis) @operator
(strong_emphasis) @operator

; Links
(link_destination) @string
(link_text) @function

; Lists
(list_item) @variable
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_from_extension() {
        assert_eq!(
            SupportedLanguage::from_extension("rs"),
            Some(SupportedLanguage::Rust)
        );
        assert_eq!(
            SupportedLanguage::from_extension("ts"),
            Some(SupportedLanguage::TypeScript)
        );
        assert_eq!(
            SupportedLanguage::from_extension("py"),
            Some(SupportedLanguage::Python)
        );
        assert_eq!(
            SupportedLanguage::from_extension("go"),
            Some(SupportedLanguage::Go)
        );
        assert_eq!(SupportedLanguage::from_extension("unknown"), None);
    }

    #[test]
    fn test_theme_default_is_dark() {
        let theme = Theme::default();
        assert_eq!(theme.foreground, Color::White);
        assert_eq!(theme.background, Color::Black);
        assert_eq!(theme.keyword, Color::Magenta);
    }

    #[test]
    fn test_highlight_type_priority() {
        assert!(SyntaxHighlighter::is_more_specific(
            HighlightType::Keyword,
            HighlightType::None
        ));
        assert!(SyntaxHighlighter::is_more_specific(
            HighlightType::Comment,
            HighlightType::Keyword
        ));
        assert!(!SyntaxHighlighter::is_more_specific(
            HighlightType::None,
            HighlightType::Keyword
        ));
    }

    #[test]
    fn test_capture_to_highlight() {
        assert_eq!(
            SyntaxHighlighter::capture_to_highlight("comment"),
            HighlightType::Comment
        );
        assert_eq!(
            SyntaxHighlighter::capture_to_highlight("keyword"),
            HighlightType::Keyword
        );
        assert_eq!(
            SyntaxHighlighter::capture_to_highlight("string"),
            HighlightType::String
        );
        assert_eq!(
            SyntaxHighlighter::capture_to_highlight("unknown"),
            HighlightType::None
        );
    }

    #[test]
    fn test_plain_text_lines() {
        let code = "line1\nline2\nline3";
        let lines = SyntaxHighlighter::plain_text_lines(code);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0][0].content, "line1");
    }
}
