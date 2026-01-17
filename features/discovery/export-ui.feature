Feature: Export Scan Results UI
  As a user who has scanned registers on my Bluetti device
  I need to export the results as a JSON file
  So that I can share my findings with others online

  # Availability
  Scenario: Download available after any scan progress
    Given I have successfully connected to a device
    And I am on the discovery page
    When I run a full scan from 0-10
    Then the "Download Results" button should be enabled

  Scenario: Download unavailable when no scan data exists
    Given I have successfully connected to a device
    And no registers have been scanned for this device
    And I am on the discovery page
    Then the "Download Results" button should be disabled

  Scenario: Download available for previous scan data
    Given I have previously scanned registers 0-1000 on this device
    Then the "Download Results" button should be enabled

  # Filename
  Scenario: Downloaded file has descriptive filename
    Given today's date is "2024-01-15"
    And I have previously scanned registers 0-1000 on this device
    When I download the results
    Then the filename should be "bluetti-TEST1234-scan-2024-01-15.json"
