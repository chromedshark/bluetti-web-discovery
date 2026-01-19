Feature: Device Connection
  As a user wanting to discover readable registers on my Bluetti device
  I need to connect to the device via Bluetooth
  So that I can communicate with it over MODBUS

  Scenario: Successfully connect to a device
    Given my browser supports Web Bluetooth
    And I am on the connection page
    When I click the "Connect" button
    And I select a Bluetti device from the Bluetooth picker
    Then I should see the device name
    And I should see the protocol version
    And I should see the device type

  Scenario: Browser does not support Web Bluetooth
    Given my browser does not support Web Bluetooth
    And I am on the connection page
    Then the "Connect" button should be disabled
    And I should see an error message indicating Web Bluetooth is not supported

  Scenario: User cancels the Bluetooth picker
    Given my browser supports Web Bluetooth
    And I am on the connection page
    When I click the "Connect" button
    And I cancel the Bluetooth picker
    Then I should remain on the connection page with no device connected
    And the "Connect" button should still be available

  Scenario Outline: Connection fails with an error
    Given my browser supports Web Bluetooth
    And I am on the connection page
    When I click the "Connect" button
    But the connection fails because <reason>
    Then I should see an error message indicating "<error_message>"

    Examples:
      | reason                            | error_message             |
      | the device never responded        | Connection timeout        |
      | a MODBUS read error occurred      | MODBUS exception: 2       |

  Scenario: User can retry after a failed connection
    Given my browser supports Web Bluetooth
    And I am on the connection page
    And a previous connection attempt failed
    When I click the "Try Again" button
    And I select a Bluetti device from the Bluetooth picker
    Then I should see the device name
