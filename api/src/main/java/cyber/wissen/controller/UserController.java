package cyber.wissen.controller;

import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cyber.wissen.dto.LoginRequest;
import cyber.wissen.dto.LoginResponse;
import cyber.wissen.dto.SignupRequest;
import cyber.wissen.entity.User;
import cyber.wissen.service.UserService;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;


@RestController
@RequestMapping(path="/auth")
@CrossOrigin(origins="*")
public class UserController {
    
    private final String SECRET_KEY = "Love + Give + Serve + Enjoy this is Cyber Wissen Value";

    @Autowired private UserService userService;

    // get all user
    @GetMapping("/users")
    public ResponseEntity<List<User>> getAllUsers() {
        List<User> users = userService.getAllUsers();
        return ResponseEntity.ok(users);
    }

    // register a new user
    @PostMapping("/signup")
    public ResponseEntity<?> registerUser(@RequestBody SignupRequest signupRequest) {

        if (userService.existsByEmail(signupRequest.getEmail())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body("Email is already in use.");
        }

        User user = new User();
        user.setEmail(signupRequest.getEmail());
        user.setPassword(signupRequest.getPassword()); // Make sure to hash the password properly
        user.setRole(signupRequest.getRole());
        user.setLangCode(signupRequest.getLangCode());
        user.setFirstname(signupRequest.getFirstname());
        user.setLastname(signupRequest.getLastname());

        // Save new user
        userService.saveUser(user);
        return ResponseEntity.status(HttpStatus.CREATED).body(user);
    }

    @PostMapping("/login")
    public ResponseEntity<?> loginUser(@RequestBody LoginRequest loginRequest) {
        Optional<User> userOptional = userService.authenticateUser(loginRequest.getEmail(), loginRequest.getPassword());
        if (userOptional.isPresent()) {
            User user = userOptional.get();

            // Create Response object
            LoginResponse loginResponse = new LoginResponse();
            loginResponse.setId(user.getId());
            loginResponse.setEmail(user.getEmail());
            loginResponse.setRole(user.getRole());
            loginResponse.setFirstName(user.getFirstname());
            loginResponse.setLastName(user.getLastname());

            String jwt = Jwts.builder()
                    .setSubject(loginRequest.getEmail())
                    .claim("pass", loginRequest.getPassword())
                    .setExpiration(new Date(System.currentTimeMillis() + 86400000)) // 1 day expiration
                    .signWith(SignatureAlgorithm.HS512, SECRET_KEY)
                    .compact();
            
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "CyberWissenBearer " + jwt);
    
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(loginResponse);
        } else {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Invalid email or password");
        }
    }
}
