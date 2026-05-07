#!/usr/bin/env python3
"""
STEP 2: AI Summarization using Claude/OpenAI
Generates plain-language summaries and flowcharts for each ticket
"""

import json
import os
import sys
from openai import OpenAI

CLAUDE_API_KEY = os.getenv('CLAUDE_API_KEY')

def generate_summary(ticket):
    """Generate AI summary and flowchart for a ticket"""
    
    client = OpenAI(api_key=CLAUDE_API_KEY, base_url="https://api.anthropic.com/v1")
    
    prompt = f"""
    Based on the following Jira ticket, provide:
    1. A clear, concise plain-language summary (2-3 sentences) suitable for a presentation
    2. A step-by-step process/flowchart (4-6 steps) of what this ticket accomplishes
    
    Ticket Details:
    - Title: {ticket['title']}
    - Description: {ticket['description']}
    - Type: {ticket['type']}
    - Story Points: {ticket['story_points']}
    
    Format your response as JSON with keys:
    - "summary": plain language summary
    - "flowchart": list of steps (each step as a string)
    - "key_benefits": list of 2-3 key benefits
    """
    
    try:
        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        response_text = message.content[0].text
        
        # Parse JSON from response
        import re
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
        else:
            result = {
                "summary": response_text,
                "flowchart": ["Step 1: Process", "Step 2: Implementation", "Step 3: Completion"],
                "key_benefits": ["Improved functionality", "Better user experience"]
            }
        
        return result
        
    except Exception as e:
        print(f"ERROR generating summary for {ticket['key']}: {e}")
        return {
            "summary": ticket['description'][:200] if ticket['description'] else "Summary not available",
            "flowchart": ["Step 1: Analysis", "Step 2: Development", "Step 3: Testing", "Step 4: Deployment"],
            "key_benefits": ["Implementation", "Testing", "Deployment"]
        }

def main():
    """Main execution"""
    print("=" * 60)
    print("STEP 2: AI SUMMARIZATION")
    print("=" * 60)
    print()
    
    if not CLAUDE_API_KEY:
        print("ERROR: CLAUDE_API_KEY secret not set")
        sys.exit(1)
    
    try:
        with open('extracted_metadata.json', 'r') as f:
            tickets = json.load(f)
    except FileNotFoundError:
        print("ERROR: extracted_metadata.json not found")
        sys.exit(1)
    
    print(f"Processing {len(tickets)} tickets...")
    print()
    
    summaries = []
    
    for i, ticket in enumerate(tickets, 1):
        print(f"  [{i}/{len(tickets)}] Summarizing {ticket['key']}: {ticket['title'][:50]}...")
        
        summary_data = generate_summary(ticket)
        
        combined = {
            **ticket,
            'ai_summary': summary_data.get('summary', ''),
            'flowchart': summary_data.get('flowchart', []),
            'key_benefits': summary_data.get('key_benefits', [])
        }
        
        summaries.append(combined)
    
    # Save summaries
    with open('ai_summaries.json', 'w') as f:
        json.dump(summaries, f, indent=2)
    
    print()
    print(f"✓ Generated AI summaries for {len(summaries)} tickets")
    print()

if __name__ == "__main__":
    main()
