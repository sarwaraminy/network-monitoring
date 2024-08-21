import React from 'react';


const Dashboard = () => {
    return (
            <div className="container-fluid mt-4">
                <div className="row mb-4">
                    <div className="col">
                        <div className="card">
                            <div className="card-body">
                                <h5 className="card-title">Total Sales</h5>
                                <p className="card-text">$15,000</p>
                            </div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="card">
                            <div className="card-body">
                                <h5 className="card-title">Orders</h5>
                                <p className="card-text">120</p>
                            </div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="card">
                            <div className="card-body">
                                <h5 className="card-title">Users</h5>
                                <p className="card-text">50</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="row">
                    <div className="col">
                        <div className="card">
                            <div className="card-body">
                                <h5 className="card-title">Products</h5>
                                <p className="card-text">200</p>
                            </div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="card">
                            <div className="card-body">
                                <h5 className="card-title">Categories</h5>
                                <p className="card-text">20</p>
                            </div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="card">
                            <div className="card-body">
                                <h5 className="card-title">Suppliers</h5>
                                <p className="card-text">15</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
    );
}

export default Dashboard;
