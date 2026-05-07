#!/usr/bin/env python3
"""
STEP 1 (continued): Extract and filter ticket metadata
Filters tickets by status and extracts key information
"""

import json
import sys

def extract_metadata():
    """Extract relevant metadata from Jira tickets"""
    
    try:
        with open('tickets.json', 'r') as f:
            tickets = json.load(f)
    except FileNotFoundError:
        print("ERROR: tickets.json not found")
        sys.exit(1)
    
    extracted_tickets = []
    
    for ticket in tickets:
        fields = ticket.get('fields', {})
        
        # Extract relevant fields
        extracted = {
            'key': ticket.get('key'),
            'title': fields.get('summary', ''),
            'description': fields.get('description', {}).get('content', [{}])[0].get('content', [{}])[0].get('text', '') if isinstance(fields.get('description'), dict) else str(fields.get('description', '')),
            'status': fields.get('status', {}).get('name', 'Unknown'),
            'assignee': fields.get('assignee', {}).get('displayName', 'Unassigned'),
            'story_points': fields.get('customfield_10015', 0),
            'type': fields.get('issuetype', {}).get('name', 'Task'),
            'url': ticket.get('self', '')
        }
        
        # Only include tickets that are "In Review" or "Done"
        if extracted['status'] in ['In Review', 'In Progress', 'Done']:
            extracted_tickets.append(extracted)
    
    # Save filtered tickets
    with open('extracted_metadata.json', 'w') as f:
        json.dump(extracted_tickets, f, indent=2)
    
    print(f"✓ Extracted metadata from {len(extracted_tickets)} tickets")
    
    # Summary by status
    status_summary = {}
    for ticket in extracted_tickets:
        status = ticket['status']
        status_summary[status] = status_summary.get(status, 0) + 1
    
    print("\nTickets by status:")
    for status, count in status_summary.items():
        print(f"  - {status}: {count}")
    
    return extracted_tickets

def main():
    """Main execution"""
    print("=" * 60)
    print("EXTRACTING TICKET METADATA")
    print("=" * 60)
    print()
    
    extract_metadata()
    
    print()
    print("✓ Metadata Extraction Complete")
    print()

if __name__ == "__main__":
    main()
