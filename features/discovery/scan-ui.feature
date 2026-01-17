Feature: Readable Range Discovery UI
  As a user who has connected to a Bluetti device
  I need to scan for readable MODBUS registers
  So that I can discover what data is available on my device

  Scenario: User initiates scan after connecting
    Given I have successfully connected to a device
    And I am on the discovery page
    When I click the "Scan" button
    Then the register scan should start

  Scenario: User can configure scan range before scanning
    Given I have successfully connected to a device
    And I am on the discovery page
    And no scan is in progress
    Then I should be able to set the starting register
    And I should be able to set the ending register

  Scenario: Progress is displayed during scan
    Given a scan is in progress
    Then I should see a progress bar with percentage
    And I should see text indicating how many registers remain to be scanned

  Scenario: Inputs are disabled during scan
    Given a scan is in progress
    Then the starting register input should be disabled
    And the ending register input should be disabled

  Scenario: User can stop an in-progress scan
    Given a scan is in progress
    When I click the "Stop" button after it has scanned some registers
    Then the scan should stop
    And all results collected so far should be saved

  Scenario: Resume option available when previous scan exists within range
    Given I have previously scanned registers 0-1000 on this device
    When I configure the scan range as 0-2000
    Then the "Resume" button should be enabled
    And the "Scan" button should be enabled

  Scenario: Resume disabled when no overlap with previous scan
    Given I have previously scanned registers 0-1000 on this device
    When I configure the scan range as 2000-3000
    Then the "Resume" button should be disabled
    And the "Scan" button should be enabled

  Scenario: Both buttons disabled when scan range is invalid
    Given I have successfully connected to a device
    And I am on the discovery page
    When I set the starting register higher than the ending register
    Then both "Resume" and "Scan" buttons should be disabled
