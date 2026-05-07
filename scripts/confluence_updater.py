#!/usr/bin/env python3
"""
STEP 3: Update Confluence Prerequisites Page
Updates the sprint demo prerequisites page with ticket summaries and flowcharts
"""

import json
import os
import sys
import requests
from requests.auth import HTTPBasicAuth

CONFLUENCE_HOST = os.getenv('CONFLUENCE_HOST')
CONFLUENCE_EMAIL = os.getenv('CONFLUENCE_EMAIL')
CONFLUENCE_API_TOKEN = os.getenv('CONFLUENCE_API_TOKEN')
PREREQUISITES_PAGE_ID = os.getenv('CONFLUENCE_PREREQUISITES_PAGE_ID')

def get_page_version(page_id):
    """Get current page version"""
    url = f"{CONFLUENCE_HOST}/rest/api/3/pages/{page_id}"
    headers = {"Accept": "application/json"}
    auth = HTTPBasicAuth(CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN)
    
    try:
        response = requests.get(url, headers=headers, auth=auth, timeout=10)
        response.raise_for_status()
        data = response.json()
        return data.get('version', {}).get('number', 1)
    except Exception as e:
        print(f"ERROR getting page version: {e}")
        return 1

def build_confluence_content(summaries):
    """Build Confluence page content from summaries"""
    
    content = """<h1>Sprint Demo — Prerequisites</h1>
<p><em>Last updated: {timestamp}</em></p>

<h2>Active Sprint Tickets Overview</h2>
<p>This page contains summaries of all tickets in the current sprint that will be demonstrated.</p>

""".format(timestamp="2026-05-07 14:00:00 UTC")
    
    # Build table with all tickets
    content += '<table><thead><tr><th>Ticket</th><th>Title</th><th>Status</th><th>Assignee</th><th>Summary</th><th>Process Steps</th></tr></thead><tbody>'
    
    for ticket in summaries:
        flowchart_steps = ' → '.join(ticket.get('flowchart', ['Step 1', 'Step 2']))
        content += f"""
<tr>
    <td><strong>{ticket['key']}</strong></td>
    <td>{ticket['title']}</td>
    <td>{ticket['status']}</td>
    <td>{ticket['assignee']}</td>
    <td>{ticket.get('ai_summary', ticket['description'][:200])}</td>
    <td><small>{flowchart_steps}</small></td>
</tr>
"""
    
    content += '</tbody></table>'
    
    # Add key benefits section
    content += '<h2>Key Deliverables</h2><ul>'
    for ticket in summaries:
        benefits = ticket.get('key_benefits', [])
        if benefits:
            content += f"<li><strong>{ticket['key']}:</strong> {', '.join(benefits)}</li>"
    content += '</ul>'
    
    return content

def update_confluence_page(page_id, content):
    """Update Confluence page with new content"""
    
    # Get current version
    version = get_page_version(page_id)
    
    url = f"{CONFLUENCE_HOST}/rest/api/3/pages/{page_id}"
    
    payload = {
        "version": {
            "number": version + 1
        },
        "title": "Sprint Demo — Prerequisites",
        "type": "page",
        "body": {
            "storage": {
                "value": content,
                "representation": "storage"
            }
        }
    }
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    auth = HTTPBasicAuth(CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN)
    
    try:
        response = requests.put(url, json=payload, headers=headers, auth=auth, timeout=20)
        response.raise_for_status()
        print(f"✓ Updated Confluence page {page_id}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"ERROR updating Confluence page: {e}")
        return False

def main():
    """Main execution"""
    print("=" * 60)
    print("STEP 3: CONFLUENCE PRE-CALL PAGE UPDATE")
    print("=" * 60)
    print()
    
    if not all([CONFLUENCE_HOST, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN, PREREQUISITES_PAGE_ID]):
        print("ERROR: Missing required Confluence credentials or page ID")
        sys.exit(1)
    
    try:
        with open('ai_summaries.json', 'r') as f:
            summaries = json.load(f)
    except FileNotFoundError:
        print("ERROR: ai_summaries.json not found")
        sys.exit(1)
    
    print(f"Building content for {len(summaries)} tickets...")
    
    # Build content
    content = build_confluence_content(summaries)
    
    # Update page
    if update_confluence_page(PREREQUISITES_PAGE_ID, content):
        print()
        print("✓ Confluence Prerequisites Page Updated")
    else:
        print("ERROR: Failed to update Confluence page")
        sys.exit(1)
    
    print()

if __name__ == "__main__":
    main()
