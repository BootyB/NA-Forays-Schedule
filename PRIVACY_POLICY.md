# Privacy Policy

**Last Updated: January 14, 2026**

## 1. Introduction and Scope

This Privacy Policy describes how our **hosted instance** of the NA Schedule Bot service (the "Service") collects, uses, and protects information when you use our hosted Service on Discord.

**Important:** This Privacy Policy applies only to our hosted Service. The NA Schedule Bot software itself is open-source under GPL-3.0, and if you run your own instance, you are responsible for your own privacy practices.

We are committed to protecting your privacy and being transparent about our data practices for our hosted Service.

## 2. Information We Collect

### 2.1 Discord Server Information

When our hosted Service is added to a Discord server, we collect and store:

- **Guild ID**: Unique identifier for your Discord server
- **Guild Name**: Name of your Discord server (encrypted)
- **Configuration Settings**: Your server's configuration preferences, including:
  - Selected host servers to display
  - Auto-update preferences
  - Channel IDs where schedules are posted (encrypted)
  - Message IDs for schedule embeds (encrypted)
  - Custom color settings

### 2.2 User Interaction Data

When users interact with our hosted Service, we may temporarily process:

- **User IDs**: Discord user identifiers for rate limiting and permissions checking
- **Command Usage**: Logged for operational purposes (non-persistent, rotation applied)

### 2.3 Rate Limiting Data

We collect temporary data for rate limiting purposes:

- User IDs and timestamp information to prevent abuse
- This data is stored in memory and not persisted to permanent storage

### 2.4 Log Data

For operational and debugging purposes, we collect:

- Error logs and system events
- Timestamps of Bot operations
- General usage statistics (non-personally identifiable)

## 3. How We Use Your Information

We use the collected information for the following purposes:

### 3.1 Service Delivery

- Displaying FFXIV raid schedules in your Discord server
- Maintaining your server-specific configuration preferences
- Providing automatic schedule updates
- Managing whitelist/blacklist access control

### 3.2 Service Improvement

- Monitoring Bot performance and uptime
- Identifying and fixing bugs
- Improving Bot features and functionality

### 3.3 Security and Abuse Prevention

- Rate limiting to prevent spam and abuse
- Enforcing whitelist/blacklist systems
- Protecting the Bot's infrastructure

### 3.4 Compliance

- Ensuring compliance with Discord's Terms of Service
- Responding to legal requirements if applicable

## 4. Data Storage and Security

### 4.1 Database Storage

- Server configuration data is stored in a MariaDB/MySQL database
- Sensitive configuration data is encrypted using AES-256-CBC encryption
- Database access is restricted and secured

### 4.2 Data Retention

- Server configurations are retained while our hosted Service remains in your server
- When the Service is removed from a server, encrypted configuration data is retained unless deletion is requested
- Log files are rotated regularly (typically 30 days)
- State data is periodically cleaned to remove inactive server entries

### 4.3 Security Measures

We implement reasonable security measures to protect your data, including:

- Encryption of sensitive data at rest
- Secure database connections
- Access controls and authentication
- Regular security updates

However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.

## 5. Data Sharing and Disclosure

### 5.1 Third-Party Services

The Bot integrates with:

- **Discord**: We transmit data to Discord's API to provide Bot functionality
- **MariaDB/MySQL Database**: For storing configuration data
- **Schedule Data Sources**: We retrieve publicly available raid schedule information

### 5.2 No Sale of Data

We do not sell, trade, or rent your personal information to third parties.

### 5.3 Legal Requirements

We may disclose information if required to do so by law or in response to valid legal requests, including:

- Compliance with legal obligations
- Protection of our rights and property
- Prevention of fraud or abuse
- Protection of user safety

## 6. Your Rights and Choices

### 6.1 Access and Control

Server administrators can:

- View their server's configuration through Bot commands
- Modify configuration settings at any time
- Remove the Bot from their server, which stops data collection

### 6.2 Data Deletion

To request deletion of your server's data:

- Remove the Bot from your Discord server
- Contact us through the project repository to request manual data deletion

### 6.3 Opt-Out

You can opt out of the Bot's services by:

- Not adding the Bot to your server
- Removing the Bot from your server
- Disabling auto-update features (while keeping the Bot)

## 7. Children's Privacy

The Bot is not directed to individuals under the age of 13 (or the applicable age of digital consent in your jurisdiction). We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us.

## 8. Open Source and Self-Hosting

The NA Schedule Bot software is open-source under GPL-3.0. This provides transparency and alternatives:

**Transparency Benefits:**
- Review the source code to understand data practices
- Audit security and privacy implementations
- Verify encryption and data handling

**Self-Hosting Option:**
- Download and run your own instance
- Full control over data storage and processing
- This Privacy Policy does not apply to self-hosted instances
- You become the data controller for your instance

If privacy is a primary concern, self-hosting gives you complete control. See the repository for setup instructions.

## 9. International Data Transfers

The Bot's infrastructure may be located in various jurisdictions. By using the Bot, you consent to the transfer of your information to these jurisdictions, which may have different data protection laws than your country.

## 10. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify users of material changes by:

- Updating the "Last Updated" date at the top of this policy
- Announcing through our repository or official channels

Continued use of our hosted Service after changes constitutes acceptance of the updated Privacy Policy.

**Note:** Changes to this Privacy Policy do not affect the GPL-3.0 license or your ability to self-host the software.

## 11. Discord's Privacy Policy

The Bot operates on Discord's platform. Discord's Privacy Policy applies to all data processed through Discord. We encourage you to review Discord's Privacy Policy at: https://discord.com/privacy

## 12. Data Breach Notification

In the event of a data breach that affects your information, we will:

- Investigate the incident promptly
- Take steps to mitigate the breach
- Notify affected users as required by applicable law
- Provide information about the breach and remediation steps

## 13. Contact Information

For questions, concerns, or requests regarding this Privacy Policy or your data, please:

- Open an issue in the project repository
- Contact the Bot developers through official channels

## 14. Compliance with Discord's Developer Terms

This Bot complies with Discord's Developer Terms of Service and Developer Policy. We adhere to Discord's data protection requirements and best practices.

## 15. Your Consent

By using our hosted Service, you consent to this Privacy Policy and agree to its terms.

**Alternatives:** If you do not agree with this Privacy Policy, you may:
- Not use our hosted Service
- Run your own instance of the software under GPL-3.0 with your own privacy practices

---

**Scope Reminder:** This Privacy Policy applies to our hosted Service only. Self-hosted instances operate under their own privacy practices.

**Source Code:** Available at the project repository under GPL-3.0  
**License:** GNU General Public License v3.0  
**Service Privacy:** This Privacy Policy (for hosted instance only)
