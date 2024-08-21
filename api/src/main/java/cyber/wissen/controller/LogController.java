package cyber.wissen.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;

import cyber.wissen.entity.Log;
import cyber.wissen.entity.User;
import cyber.wissen.service.JwtService;
import cyber.wissen.service.LogService;
import cyber.wissen.service.UserService;




@Controller
@CrossOrigin(origins="*")
@RequestMapping(path = "/api")
public class LogController {
    
    @Autowired JwtService jwtService;
    @Autowired private LogService logService;
    @Autowired UserService userService;

    // Get all logs
    @PostMapping("/logs")
    public ResponseEntity<List<Log>> getAllLogs(@RequestHeader("Authorization") String authHeader) {
        String email = jwtService.extractEmailFromToken(authHeader);
        User user = userService.getUserByEmail(email);
        
        if (user != null) {
            return ResponseEntity.ok(logService.getAllLogs());
        } else {
            return ResponseEntity.noContent().build();
        }
    }
    
    // Create Log
    @PostMapping("/log/add")
    public ResponseEntity<Log> createLog(@RequestBody Log log, @RequestHeader("Authorization") String authHeader) {
        // check the user is valid
        String email = jwtService.extractEmailFromToken(authHeader);
        User user = userService.getUserByEmail(email);
        
        if (user != null) {
            return ResponseEntity.status(HttpStatus.CREATED).body(logService.saveLog(log));
        } else {
            return ResponseEntity.notFound().build();
        }
    }
    
    // Update a log
    @PutMapping("log/{id}")
    public ResponseEntity<Log> updateLog(@PathVariable Long id, @RequestBody Log logDetail, @RequestHeader("Authorization") String authHeader) {
        // check the user is valid
        String email = jwtService.extractEmailFromToken(authHeader);
        User user = userService.getUserByEmail(email);
        
        if (user != null) {
            if (logService.getLogById(id) != null) {
                return ResponseEntity.ok(logService.saveLog(logDetail));
            } else {
                return ResponseEntity.notFound().build();
            }
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    // Delete a record
    @DeleteMapping("/log/{id}")
    public ResponseEntity<Log> deleteLog(@PathVariable Long id, @RequestHeader("Authorization") String authHeader ) {
        // check the user is valid
        String email = jwtService.extractEmailFromToken(authHeader);
        User user = userService.getUserByEmail(email);

        if (user != null ) {
            logService.deleteLog(id);
            return ResponseEntity.noContent().build(); 
        } else {
            return ResponseEntity.notFound().build();
        }
    }

}
