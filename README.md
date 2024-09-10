<h1>install winPcap from <a href="https://npcap.com/#download">nPcap Download</a></h1>
<h4>Run your application as administrator to capture packet</h4>

<div class="markdown prose w-full break-words dark:prose-invert light">
  <h1>Network Monitoring Tool (NMT)</h1>
  <p>The <strong>Network Monitoring Tool (NMT)</strong> is a powerful and customizable tool designed to monitor and analyze network traffic in real-time. It allows users to capture network packets, identify potential anomalies such as Man-In-The-Middle (MITM) attacks, ARP spoofing, and suspicious activity, and gather detailed insights on IP addresses, including geolocation information.</p><p>This project leverages modern technologies for both the backend and frontend:
  </p>
  <ul>
    <li><strong>Frontend:</strong> ReactJS</li>
    <li><strong>Backend:</strong> Spring Boot (Java)</li>
    <li><strong>Database:</strong> PostgreSQL</li>
  </ul>

  <h2>Key Features</h2>
   <ul>
    <li>
      <p><strong>Packet Capture:</strong></p>
      <ul>
        <li>Capture network traffic from a selected interface.</li>
        <li>Optionally filter packet capture by specifying a particular IP address or interface.</li>
      </ul>
    </li>
    <li>
      <p><strong>Anomaly Detection:</strong></p>
      <ul>
        <li>Real-time anomaly detection using custom logic.</li>
        <li>Detection of network threats such as MITM attacks, ARP spoofing, and packet anomalies.</li>
      </ul>
    </li>
    <li>
      <p><strong>IP Address Lookup:</strong></p>
      <ul><li>WHOIS lookup integrated to identify the geographical information of IP addresses found in captured packets.</li></ul>
    </li>
    <li>
      <p><strong>User-Friendly UI:</strong></p>
      <ul>
        <li>A ReactJS-based intuitive and responsive interface to control packet capture, view detailed packet information, and analyze anomalies.</li>
        <li>Data visualization and logs for packet analysis.</li>
      </ul>
    </li>
   </ul>

   <h2>Technology Stack</h2>
   <h3>Frontend:</h3>
   <ul><li><strong>ReactJS:</strong> A modern JavaScript library for building fast, interactive user interfaces.</li></ul>
   <h3>Backend:</h3>
   <ul><li><strong>Spring Boot:</strong> A Java-based framework to develop REST APIs, handle business logic, and process data efficiently.</li></ul>
   <h3>Database:</h3>
   <ul><li><strong>PostgreSQL:</strong> A reliable and powerful open-source relational database to store captured network traffic and analysis results.</li></ul>
   
   <h2>Installation</h2>
   <h3>Prerequisites</h3>
   <p>Ensure that you have the following software installed:</p>
   <ul>
     <li>Java 17+</li>
     <li>Node.js &amp; npm</li>
     <li>PostgreSQL 14+</li>
   </ul>
   <h3>Backend (Spring Boot)</h3>
   <ol>
     <li>
       <p>Clone the repository:</p>
        <code style="background-color: gray; color: lightcyan; font-weight: bold;">
          git <span class="hljs-built_in">clone</span> https://github.com/sarwaraminy/network-monitoring.git <br>
          <span>cd</span> api<br>
          <span>mvn clean install</span>
          <span>java -jar target/network-monitoring-0.0.1-SNAPSHOT.jar</span>
        </code>
     </li>
     <li>
      <p>Configure the PostgreSQL database in <code style="background-color: gray; color: lightcyan; font-weight: bold;">application.properties</code>:</p>
      <code style="background-color: gray; color: lightcyan; font-weight: bold;">
        spring.datasource.url=jdbc:postgresql://localhost:5432/nmt_db <br>
        spring.datasource.username=your_db_username <br>
        spring.datasource.password=your_db_password <br>
      </code>
     </li>
     <li>
      <p>Run the FlywayDB migrations to set up the database schema:</p>
      <code style="background-color: gray; color: lightcyan; font-weight: bold;">./mvnw flyway:migrate</code>
     </li>
     <h3>Frontend (ReactJS)</h3>
     <li>
      <p>Install dependencies:</p>
      <code style="background-color: gray; color: lightcyan; font-weight: bold;">npm install</code>
     </li>
     <li>
      <p>Start React:</p>
      <code style="background-color: gray; color: lightcyan; font-weight: bold;">npm start</code>
     </li>
   </ol>
   
   <p>The app will be available at <code>http://localhost:3000</code>.</p>
   
   <h2>Usage</h2>
   <ol>
    <li><strong>Select Network Interface</strong>: From the frontend, choose a network interface from which to capture traffic.</li>
    <li><strong>Packet Capture</strong>: Initiate packet capture by specifying either an interface or an interface+IP combination.</li>
    <li><strong>Analyze Packets</strong>: The system will process captured packets and provide real-time analysis for anomalies.</li>
    <li><strong>WHOIS Lookup</strong>: Get geographical and domain information about IP addresses from the captured packets.</li>
    <li><strong>View Results</strong>: Review network anomalies, IP details, and packet logs in a user-friendly interface.</li>
  </ol>
  <h2>Future Plans</h2>
  <ul>
    <li>Advanced data visualization for packet analysis.</li>
    <li>Real-time notifications for detected network anomalies.</li>
    <li>Support for multiple protocols in packet analysis.</li>
  </ul>
  <h2>Contributing</h2>
  <p>Contributions are welcome! Please open an issue or submit a pull request with any improvements or new features.</p>
  <h2>License</h2>
  <p>This project is licensed under the MIT License. See the <code>LICENSE</code> file for more details.</p><hr>
  <p>Feel free to adjust it as necessary, especially the repository links and specific details based on your setup!</p>

  <h3>Screenshoots:</h3>
  <h4>Login page:</h4>
  <img alt=" " src="./screenshots/login.png" />
  <hr>
  <h4>Dashboard:</h4>
  <img alt=" " src="./screenshots/Logs.png" />
  <hr>
  <h4>Scan packets from an specific Interface:</h4>
  <img alt=" " src="./screenshots/scanPacket.png" />
  <hr>
  <h4>Scan packets from an specific Interface/IP:</h4>
  <img alt=" " src="./screenshots/scanPacketIP.png" />
  <hr>
  <h4>Whois Lookup service</h4>
  <img alt=" " src="./screenshots/whoisLookup.png" />
</div>