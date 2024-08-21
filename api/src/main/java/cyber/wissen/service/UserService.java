package cyber.wissen.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import cyber.wissen.entity.User;
import cyber.wissen.repo.UserRepository;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private BCryptPasswordEncoder passwordEncoder;

    // check if email exists
    public boolean existsByEmail(String email){
        return userRepository.existsByEmail(email);
    }
    
	// Get user by email
	public User getUserByEmail(String email){
		return userRepository.findByEmail(email).orElse(null);
	}
	
    //
	public List<User> getAllUsers(){ //get all records from Users table
		Iterable<User> iterable = userRepository.findAll();
		List<User> UsersList = new ArrayList<>();
		iterable.forEach(UsersList::add);
		return UsersList;
	}
	
	// 
	public User getUserById(long id) { //Get data from Users table based on id
		return userRepository.findById(id).orElse(null);
	}
	
	// 
	public User saveUser(User user) { // insert new records from form int Users table
		// Check if email already exists
		if(userRepository.findByEmail(user.getEmail()).isPresent()){
			throw new IllegalStateException("Email already exists");
		}

		// Encode the user's password
		user.setPassword(passwordEncoder.encode(user.getPassword()));

		// Save the user to the Users table
		User savedUser = userRepository.save(user);
		return savedUser;
	}
	
	//
	public void deleteUser(long id) {
		userRepository.deleteById(id);
	}

	public Optional<User> authenticateUser(String email, String password) {
        Optional<User> userOptional = userRepository.findByEmail(email);
        if (userOptional.isPresent() && passwordEncoder.matches(password, userOptional.get().getPassword())) {
            return userOptional;
        } else {
            return Optional.empty();
        }
    }
}
