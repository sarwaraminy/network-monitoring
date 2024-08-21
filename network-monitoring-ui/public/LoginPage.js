import { useState } from 'react';
import { useNavigate } from 'react-router-dom';


import { useUser } from './contexts/UserContext';
import { useAuth } from './contexts/AuthContext';

export const LoginPage = () => {
  const [rememberMe, setRememberMe] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [message, setMessage] = useState('');
  const [showPass, setShowPass] = useState(false); // State to toggle password visibility

  const [loading, setLoading] = useState(false);

  const eyeSvgDim = 25;

  const { updateUserData } = useUser();
  const { login } = useAuth();

  const navigate = useNavigate();

  //const generateToken = () => {
  //  let array = new Uint16Array(96);
  //  window.crypto.getRandomValues(array);
  //  return Array.from(array, (byte) => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
  //};

  const handleLogin = async () => {
    setMessage('');
    setLoading(true);

    const data = {
      userid: user,
      pass: pass
    };

    try {
      const response = await fetch(`${process.env.REACT_APP_JAVA_URI}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      
      if (response.ok) {
        setUser('');
        setPass('');

        login(user, pass);
        updateUserData({
          userid: user,
          pass: pass
        });

        const token = response.headers.get('Authorization');
        localStorage.setItem('token', token);

        navigate('/');
      } else {
        setMessage(result.message || 'Login failed');
        setLoading(false);
      }
    } catch (error) {
      setMessage('The system is unavailable at this time.');
      setLoading(false);
    }
    
  };

  return (
    <div className='d-flex align-items-center justify-content-center' style={{ height: '80vh' }}>
      <div className="container login_page" >
        <div className="row ">
          <div className="col-md-6 ">

            <img alt=" " src='/images/PRO_dashboardlogo.png' width='350' height='220' />
          </div>
          <div className="col-md-3 border p-4" id='pro-login'>
            {message && <div className="alert alert-danger">{message}</div>}
            <h2>Login</h2>

            <form onSubmit={(e) => {
              e.preventDefault(); // Prevent default form submission
              handleLogin(); // Handle login logic
            }}>
              <div className="form-group">
                <label htmlFor="user">User Name</label>
                <input type="text" className="form-control" id="user"
                  placeholder="User Name"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleLogin();
                    }
                  }} aria-describedby="emailHelp" />
              </div>
              <div className="form-group mt-3 mb-1">
                <label htmlFor="pass">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'} // Toggle between 'text' and 'password'
                    className="form-control"
                    id="pass"
                    placeholder="Password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleLogin();
                      }
                    }}
                  />
                  <i // Eye icon
                    style={{ position: 'absolute', top: '50%', right: '10px', transform: 'translateY(-50%)', cursor: 'pointer' }}
                    onClick={() => setShowPass(!showPass)} // Toggle showPass state on click
                  >
                    {showPass ? <img alt = " " src='/icons/show-pwd.svg' width={eyeSvgDim} height={eyeSvgDim} /> : <img alt = " " src='/icons/hide-pwd.svg' width={eyeSvgDim} height={eyeSvgDim} />}
                  </i>
                </div>
              </div>

              <div className="form-group">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                <label className="form-label" htmlFor="rememberMe">
                  Remember Me
                </label>
              </div>
              <a href='/forgot-pass' className='mt-2'>Forgot Password?</a><br />
              <div className="d-grid gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-block mt-3"
                  onClick={handleLogin}
                  disabled={!user || !pass}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                      <span className="text-light">Authenticating...</span>
                    </>
                  ) : (
                    <span>Login</span>
                  )}
                  
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

    </div>
  );

};
