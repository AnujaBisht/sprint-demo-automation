#!/usr/bin/env python3
"""
STEP 1: Fetch active sprint tickets from Jira
Extracts all tickets from the active sprint in the Astro project
"""

import os
import json
import requests
from datetime import datetime
from requests.auth import HTTPBasicAuth

JIRA_HOST = os.getenv('JIRA_HOST')
JIRA_EMAIL = os.getenv('JIRA_EMAIL')
JIRA_API_TOKEN = os.getenv('JIRA_API_TOKEN')
JIRA_PROJECT = os.getenv('JIRA_PROJECT', 'Astro')

def get_active_sprint():
    """Fetch the active sprint from Jira"""
    url = f"{JIRA_HOST}/rest/api/3/board"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    auth = HTTPBasicAuth(JIRA_EMAIL, JIRA_API_TOKEN)
    
    try:
        response = requests.get(url, headers=headers, auth=auth, timeout=10)
        response.raise_for_status()
        
        boards = response.json().get('values', [])
        
        # Find the board for the Astro project
        for board in boards:
            if JIRA_PROJECT.lower() in board.get('name', '').lower():
                board_id = board['id']
                
                # Get sprints for this board
                sprints_url = f"{JIRA_HOST}/rest/api/3/board/{board_id}/sprint"
                sprints_response = requests.get(sprints_url, headers=headers, auth=auth, timeout=10)
                sprints_response.raise_for_status()
                
                sprints = sprints_response.json().get('values', [])
                
                # Find the active sprint
                for sprint in sprints:
                    if sprint.get('state') == 'active':
                        return sprint['id'], board_id
        
        print("ERROR: No active sprint found")
        return None, None
        
    except requests.exceptions.RequestException as e:
        print(f"ERROR fetching active sprint: {e}")
        return None, None

def fetch_sprint_tickets(board_id, sprint_id):
    """Fetch all tickets from the active sprint"""
    url = f"{JIRA_HOST}/rest/api/3/search"
    
    jql = f'project = {JIRA_PROJECT} AND sprint = {sprint_id} ORDER BY updated DESC'
    
    params = {
        'jql': jql,
        'maxResults': 100,
        'fields': 'key,summary,description,status,assignee,customfield_10015,issuetype'
    }
    
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    auth = HTTPBasicAuth(JIRA_EMAIL, JIRA_API_TOKEN)
    
    try:
        response = requests.get(url, headers=headers, params=params, auth=auth, timeout=30)
        response.raise_for_status()
        
        tickets = response.json().get('issues', [])
        
        # Save to file for next step
        with open('tickets.json', 'w') as f:
            json.dump(tickets, f, indent=2, default=str)
        
        print(f"✓ Fetched {len(tickets)} tickets from active sprint")
        return tickets
        
    except requests.exceptions.RequestException as e:
        print(f"ERROR fetching sprint tickets: {e}")
        return []

def main():
    """Main execution"""
    print("=" * 60)
    print("STEP 1: JIRA DATA EXTRACTION")
    print("=" * 60)
    
    if not all([JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN]):
        print("ERROR: Missing required Jira credentials in secrets")
        exit(1)
    
    print(f"Connecting to Jira: {JIRA_HOST}")
    print(f"Project: {JIRA_PROJECT}")
    print()
    
    # Get active sprint
    sprint_id, board_id = get_active_sprint()
    if not sprint_id:
        print("ERROR: Could not find active sprint")
        exit(1)
    
    print(f"✓ Found active sprint: {sprint_id}")
    
    # Fetch tickets
    tickets = fetch_sprint_tickets(board_id, sprint_id)
    
    if not tickets:
        print("WARNING: No tickets found in active sprint")
    
    print()
    print("✓ JIRA Data Extraction Complete")
    print()

if __name__ == "__main__":
    main()
