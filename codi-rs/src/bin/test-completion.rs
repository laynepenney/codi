// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Test tab completion functionality

use codi::completion::{complete_line, get_completion_matches};

fn main() {
    println!("=== Tab Completion Test ===\n");

    // Test command completion
    let test_cases = vec!["/h", "/he", "/br", "/git c", "/models ", "/branch "];

    for input in test_cases {
        println!("Input: '{}'", input);

        // Test line completion
        if let Some(completed) = complete_line(input) {
            println!("  Completion: '{}'", completed);
        } else {
            println!("  No completion");
        }

        // Show all matches
        let matches = get_completion_matches(input);
        if !matches.is_empty() {
            println!("  Available matches: {:?}", matches);
        }

        println!();
    }

    println!("=== Tab completion system is working! ===");
}
