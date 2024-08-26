import React, { useState, useEffect } from 'react';
import axios from 'axios';

const PacketCaptureWithIP = () => {
    const [packets, setPackets] = useState([]);
    const [capturing, setCapturing] = useState(false);
    const [networkInterfaces, setNetworkInterfaces] = useState([]);
    const [selectedInterface, setSelectedInterface] = useState('');
    const [selectedIp, setSelectedIp] = useState('');
    const [ipInfo, setIpInfo] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [filterIp, setFilterIp] = useState('');

    const startCapture = async () => {
        try {
            await axios.post(`${process.env.REACT_APP_API_SERVER}/api/ip/packets/start`, null, {
                params: { interfaceName: selectedInterface, ipAddress: filterIp }
            });
            setCapturing(true);
        } catch (error) {
            console.error('Error starting packet capture:', error);
        }
    };

    useEffect(() => {
        const fetchNetworkInterfaces = async () => {
            try {
                const response = await axios.get(`${process.env.REACT_APP_API_SERVER}/api/ip/packets/nif`);
                setNetworkInterfaces(response.data);
            } catch (error) {
                console.error('Error fetching network interfaces:', error);
            }
        };

        fetchNetworkInterfaces();
    }, []);

    const handleInterfaceChange = (e) => {
        setSelectedInterface(e.target.value);
    };

    const handleIpChange = (e) => {
        setFilterIp(e.target.value);
    };

    const stopCapture = async () => {
        try {
            await axios.post(`${process.env.REACT_APP_API_SERVER}/api/ip/packets/stop`);
            setCapturing(false);
        } catch (error) {
            console.error('Error stopping packet capture:', error);
        }
    };

    useEffect(() => {
        if (capturing) {
            const interval = setInterval(() => {
                axios.get(`${process.env.REACT_APP_API_SERVER}/api/ip/packets`)
                    .then(response => {
                        setPackets(response.data);
                    })
                    .catch(error => console.error('Error fetching packets:', error));
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [capturing]);

    const clearPacket = async () => {
        try {
            await axios.post(`${process.env.REACT_APP_API_SERVER}/api/ip/packets/clear`);
            setPackets([]);
        } catch (error) {
            console.error('Error clearing data:', error);
        }
    };

    const handleIpClick = async (ipAddress) => {
        try {
            const response = await axios.get(`${process.env.REACT_APP_API_SERVER}/api/ip/packets/ip-info`, {
                params: { ipAddress }
            });
            setSelectedIp(ipAddress);
            setIpInfo(response.data);
            setShowModal(true);
        } catch (error) {
            console.error('Error fetching IP information:', error);
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setIpInfo(null);
    };

    return (
        <div className='container-fluid mt-3'>
            <div className="mb-3 row">
                <div className='form-group col-md-3'>
                    <label htmlFor="networkInterface">Select Network Interface:</label>
                    <select className='form-select' id="networkInterface" value={selectedInterface} onChange={handleInterfaceChange}>
                        <option value="">Select an interface</option>
                        {networkInterfaces.map((networkInterface, index) => (
                            <option key={index} value={networkInterface.name}>
                                {networkInterface.description || networkInterface.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className='form-group col-md-3'>
                    <label htmlFor="filterIp">Filter by IP Address:</label>
                    <input 
                        type="text" 
                        className='form-control' 
                        id="filterIp" 
                        value={filterIp} 
                        onChange={handleIpChange} 
                        placeholder="Enter IP address to filter"
                    />
                </div>
                <div className="form-group col-md">
                    <label htmlFor="buttons">Packet Capture:</label>
                    <div id="buttons">
                        <button className='btn btn-primary me-2' onClick={startCapture} disabled={capturing}>Start Capture</button>
                        <button className='btn btn-warning me-2' onClick={stopCapture} disabled={!capturing}>Stop Capture</button>
                        <button className='btn btn-danger me-2' onClick={clearPacket}>Clear Captured Packets</button>
                    </div>
                    
                </div>
            </div>
            
            <h2>Captured Packets</h2>
            <div className="table-container">
                <table className='table table-striped table-bordered table-hover'>
                    <thead className="sticky-header">
                        <tr>
                            <th>Destination Host</th>
                            <th>Destination IP</th>
                            <th>Source Host</th>
                            <th>Source IP</th>
                            <th>Type</th>
                            <th>LLC DSAP</th>
                            <th>LLC SSAP</th>
                            <th>LLC Control</th>
                            <th>Data</th>
                            <th>Ethernet Pad</th>
                        </tr>
                    </thead>
                    <tbody>
                        {packets && packets.map((packet, i) => (
                            <tr key={i}>
                                <td>{packet.ethernetHeader.destinationAddress}</td>
                                <td>
                                    <button className='btn btn-link' onClick={() => handleIpClick(packet.destinationIpAddress)}>
                                        {packet.destinationIpAddress}
                                    </button>
                                </td>
                                <td>{packet.ethernetHeader.sourceAddress}</td>
                                <td>
                                    <button className='btn btn-link' onClick={() => handleIpClick(packet.sourceIpAddress)}>
                                        {packet.sourceIpAddress}
                                    </button>
                                </td>
                                <td>{packet.ethernetHeader.type}</td>
                                <td>{packet.llcHeader?.dsap}</td>
                                <td>{packet.llcHeader?.ssap}</td>
                                <td>{packet.llcHeader?.control}</td>
                                <td>{packet.dataHexStream || ''}</td>
                                <td>{packet.ethernetPadHexStream || ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="row mt-3"><div className="col-md-12 text-center font-weight-bold">Total Number of Records: {packets.length}</div></div>

            {/* Bootstrap Modal */}
            {showModal && ipInfo && (
                <div className="modal show d-block" tabIndex="-1">
                    <div className="modal-dialog modal-dialog-scrollable" role="document">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">IP Information for {selectedIp}</h5>
                                <button type="button" className="close" aria-label="Close" onClick={handleCloseModal}>
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            <div className="modal-body">
                                <p><strong>Domain Name:</strong> {ipInfo.domainName}</p>
                                <p><strong>WHOIS Data:</strong> <pre>{ipInfo.whoisData}</pre></p>

                                <h5>Geolocation</h5>
                                <table className='table table-striped table-bordered'>
                                    <tbody>
                                        <tr>
                                            <td><strong>Country</strong></td>
                                            <td>{ipInfo.geoData.country}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>City</strong></td>
                                            <td>{ipInfo.geoData.city}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Region</strong></td>
                                            <td>{ipInfo.geoData.regionName}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Latitude</strong></td>
                                            <td>{ipInfo.geoData.lat}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Longitude</strong></td>
                                            <td>{ipInfo.geoData.lon}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>ISP</strong></td>
                                            <td>{ipInfo.geoData.isp}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Organization</strong></td>
                                            <td>{ipInfo.geoData.org}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Timezone</strong></td>
                                            <td>{ipInfo.geoData.timezone}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PacketCaptureWithIP;
