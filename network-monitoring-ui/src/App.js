import React from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet } from "react-router-dom";
import PrivateRoute from "./auth/PrivateRoute";
import './App.css';

import { LoginPage } from './auth/LoginPage';
import { SignUpPage } from './auth/SignUp';

import { UserProvider } from './contexts/UserContext';
import { AuthProvider } from './contexts/AuthContext';
import NavigationBar from './dashboard/NavigationBar';
import Dashboard from './dashboard/Dashboard';
import LogPage from './pages/LogPage';
import PacketCapture from './pages/PacketCapture';

const App = () => {
  return (
    <UserProvider>
      <AuthProvider>
        <Router>
            <div className="container-fluid mt-4">
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/sign-up" element={<SignUpPage />} />
                    <Route path="/" element={<PrivateRoute />}>
                        <Route 
                            path="/" 
                            element={
                                <>
                                    <NavigationBar />
                                    <Outlet />
                                </>
                            }
                        >
                            <Route index element={<Dashboard />} />
                            <Route path='/logs' element={<LogPage />} />
                            <Route path='/capture-packets' element={<PacketCapture />} />
                        </Route>
                    </Route>
                </Routes>
            </div>
        </Router>
      </AuthProvider>
    </UserProvider>
);
}

export default App;
