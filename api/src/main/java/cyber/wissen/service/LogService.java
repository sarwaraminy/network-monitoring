package cyber.wissen.service;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import cyber.wissen.entity.Log;
import cyber.wissen.repo.LogRepository;

@Service
public class LogService {
    
    @Autowired private LogRepository logRepository;

    // get all logs
    public List<Log> getAllLogs() {
        Iterable<Log> iterable = logRepository.findAll();
        List<Log> logList = new ArrayList<>();
        iterable.forEach(logList::add);
        return logList;
    }

    // get log by id
    public Log getLogById(Long id) {
        return logRepository.findById(id).orElse(null);
    }

    // Create log
    public Log saveLog(Log log) {
        return logRepository.save(log);
    }

    // delet log
    public void deleteLog(Long id) {
        logRepository.deleteById(id);
    }
}
