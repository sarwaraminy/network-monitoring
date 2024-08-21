import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export const LogoutButton = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        try {
            await logout(); // Assuming logout function handles clearing auth tokens or session
            navigate('/login'); // Navigate to login page after logout
        } catch (error) {
            console.error("Logout failed", error);
            // Handle logout failure, if needed
        }
    };

    return (
        <span className="dropdown-item text-light" role="button" onClick={handleLogout}>
            Logout
        </span>
    );
};
