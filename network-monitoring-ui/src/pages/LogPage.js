import React, { useEffect, useState } from "react";
import axios from "axios";

const LogPage = () => {
    const [logs, setLogs] = useState([]);
    const token = localStorage.getItem('token');
    const [selectedIp, setSelectedIp] = useState('');
    const [ipInfo, setIpInfo] = useState(null);
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        try{
            const response = await axios.post(`${process.env.REACT_APP_API_SERVER}/api/logs`, {}, {
                headers: {
                    'Authorization': `${token}`
                }
            });
            setLogs(response.data);
        } catch (error){
            console.error('Error fetching Logs:', error);
        }
    };

    const handleIpClick = async (ipAddress) => {
        try {
            const response = await axios.get(`${process.env.REACT_APP_API_SERVER}/api/packets/ip-info`, {
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
        <>
        <div className="table-container mt-3">
            <h3>Anomaly Packets</h3>
            <table className="table table-striped table-bordered table-hover">
                <thead className="sticky-header">
                    <tr>
                        <th>Timestamp</th>
                        <th>Source IP</th>
                        <th>Source MAC</th>
                        <th>Destination IP</th>
                        <th>Destination MAC</th>
                        <th>IP Version</th>
                        <th>Protocol</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    {logs && logs.map(log => (
                        <tr key={log.id}>
                            <td>{log.timestamp}</td>
                            <td>
                                <button className='btn btn-link' onClick={() => handleIpClick(log.sourceip)}>
                                    {log.sourceip}
                                </button>
                            </td>
                            <td>{log.sourcemac}</td>
                            <td>
                                <button className='btn btn-link' onClick={() => handleIpClick(log.destinationip)}>
                                    {log.destinationip}
                                </button>
                            </td>
                            <td>{log.destinationmac}</td>
                            <td>{log.ipversion}</td>
                            <td>{log.protocol}</td>
                            <td>{log.details}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        <div className="row mt-3"><div className="col-md-12 text-center font-weight-bold">Total Number of Records: {logs.length}</div></div>

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
        </>
    );
};

export default LogPage;