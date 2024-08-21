import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.REACT_APP_ENCRYPTION_KEY || 'default_key'; // Replace with your secure key

const PrivateRoute = () => {
  const { userData } = useUser();
  const { userid, pass } = userData;
  const encryptedTokenName = localStorage.getItem(process.env.REACT_APP_tokenKeyName);
  let isAuthenticated = false;

  // Check if the userid and password are empty, then force user to relogin
  if (!userid || !pass) {
    isAuthenticated = false;
  } else if (encryptedTokenName) {
    try {
      const decryptedTokenName = CryptoJS.AES.decrypt(encryptedTokenName, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
      isAuthenticated = decryptedTokenName === `Love${userid}cyberWissenAuthToken + Give + Serve${pass}And Enjoy`;
    } catch (error) {
      console.error('Decryption error:', error);
      isAuthenticated = false;
    }
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" />;
};

export default PrivateRoute;
